/**
 * EmotiVoice — Acil Arama + Ebeveyn Bildirim Sistemi
 *
 * YENİ ÖZELLİKLER:
 * 1. Çocuk ekranında büyük kırmızı "ACİL" butonu (3 sn basılı tutma ile tetiklenir)
 * 2. AsyncStorage tabanlı bildirim kuyruğu (ev_alerts_pid)
 * 3. Ebeveyn üst barında 🔔 zil + kırmızı okunmamış badge (titreşimli)
 * 4. Ebeveyn panelinde "🚨 Bildirimler" sekmesi — okundu / sil
 * 5. Duygu analizi sonucu Üzgün/Öfkeli ise otomatik bildirim gönderilir
 * 6. "Çok Üzgünüm / Çok Sinirliyim" hızlı bildirim butonları
 * 7. Haptics desteği (kurulu değilse sessizce geçer)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Animated, Easing, KeyboardAvoidingView, Platform,
  Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { Audio } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Haptics — kurulu değilse sessizce geç
let Haptics: any = null;
try { Haptics = require("expo-haptics"); } catch {}

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen     = "onboard"|"auth"|"reg_parent"|"reg_child"|"login"|"parent_home"|"child_home";
type ParentTab  = "analyze"|"history"|"alerts";
type EmotionKey = "NEUTRAL"|"SADNESS"|"HAPPY"|"ANGER";
type AlertLevel = "emergency"|"sad"|"anger"|"info";

type Result   = { label?:string; confidence?:number; is_anomaly?:boolean; scores?:Record<string,number>; error?:string; };
type HistItem = { id:string; createdAt:string; result:Result; };
type AlertItem = {
  id:string; parentId:string; childId:string; childName:string;
  level:AlertLevel; message:string; createdAt:string; read:boolean;
};

type ParentAcc = { role:"parent"; parentId:string; parentName:string; email:string; childName:string; childAge:string; notes:string; passwordHash:string; };
type ChildAcc  = { role:"child";  childId:string;  childName:string;  parentId:string; passwordHash:string; };
type Account   = ParentAcc | ChildAcc;

// ─── Tokens ───────────────────────────────────────────────────────────────────

const T = {
  bg:"#FAF8F5", bgCard:"#FFFFFF", bgCard2:"#F4F1ED", surface:"#EDE9E4",
  primary:"#6048E8", pLight:"#8B78F0", pBg:"#EEE9FF",
  coral:"#F0654A", coralBg:"#FFF0ED",
  green:"#2EB872", greenBg:"#E8F8EF",
  amber:"#F5A623", amberBg:"#FFF6E8",
  sky:"#2196F3",   skyBg:"#E8F4FF",
  ink:"#1A1635",   inkMid:"#6B6684",  inkLight:"#ABA8BF",
  border:"#E8E4DE",
  red:"#E53935",   redBg:"#FEECEB",   redDeep:"#C62828",
};

const ALERT_META: Record<AlertLevel,{emoji:string;label:string;color:string;bg:string;border:string;}> = {
  emergency: { emoji:"🆘", label:"ACİL YARDIM", color:"#C62828", bg:"#FEECEB", border:"#EF9A9A" },
  anger:     { emoji:"😤", label:"Öfke Krizi",  color:T.coral,   bg:T.coralBg, border:"#F8C4B8" },
  sad:       { emoji:"😢", label:"Çok Üzgün",   color:T.sky,     bg:T.skyBg,   border:"#B3D8F8" },
  info:      { emoji:"ℹ️",  label:"Bilgi",       color:T.inkMid,  bg:T.surface, border:T.border  },
};

const EM: Record<EmotionKey,{label:string;emoji:string;color:string;bg:string;border:string;childMsg:string;grad:[string,string];alertLevel?:AlertLevel;}> = {
  NEUTRAL:{ label:"Nötr",   emoji:"😐", color:T.inkMid, bg:"#F4F2F8", border:"#D4D0E8", childMsg:"Bugün oldukça sakinsin 🌿",          grad:["#F4F2F8","#E8E4F4"] },
  SADNESS:{ label:"Üzgün",  emoji:"😢", color:T.sky,    bg:T.skyBg,   border:"#B3D8F8", childMsg:"Biraz üzgün hissediyorsun. 🤗",       grad:["#E8F4FF","#D0EAFF"], alertLevel:"sad"   },
  HAPPY:  { label:"Mutlu",  emoji:"😄", color:T.green,  bg:T.greenBg, border:"#A8E8C8", childMsg:"Bugün çok mutlusun! 🌟",              grad:["#E8F8EF","#D0F0E0"] },
  ANGER:  { label:"Öfkeli", emoji:"😤", color:T.coral,  bg:T.coralBg, border:"#F8C4B8", childMsg:"Biraz sinirli hissediyorsun. 🌈",     grad:["#FFF0ED","#FFE4DE"], alertLevel:"anger" },
};
const EMO_ORDER: EmotionKey[] = ["HAPPY","NEUTRAL","SADNESS","ANGER"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const genId    = (p:string) => p+Math.random().toString(36).slice(2,8).toUpperCase();
const doHash   = (s:string) => { let h=0; for(let i=0;i<s.length;i++) h=(Math.imul(31,h)+s.charCodeAt(i))|0; return h.toString(16); };
const fmtDate  = (iso:string) => { const d=new Date(iso); return `${d.toLocaleDateString("tr-TR")} · ${d.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"})}`; };
const initials = (n:string) => n.trim().split(" ").map(w=>w[0]?.toUpperCase()||"").join("").slice(0,2);

const API_URL      = "http://192.168.1.107:8000/predict";
const ACCOUNTS_KEY = "ev_accs_v3";
const SESSION_KEY  = "ev_sess_v3";
const hKey = (pid:string) => `ev_hist_${pid}`;
const aKey = (pid:string) => `ev_alerts_${pid}`;

const loadAccs   = async():Promise<Account[]>    => {try{const r=await AsyncStorage.getItem(ACCOUNTS_KEY);return r?JSON.parse(r):[];}catch{return[];}};
const saveAccs   = async(l:Account[])            => AsyncStorage.setItem(ACCOUNTS_KEY,JSON.stringify(l)).catch(()=>{});
const loadSess   = async():Promise<Account|null> => {try{const r=await AsyncStorage.getItem(SESSION_KEY);return r?JSON.parse(r):null;}catch{return null;}};
const saveSess   = async(a:Account|null)         => a?AsyncStorage.setItem(SESSION_KEY,JSON.stringify(a)).catch(()=>{}):AsyncStorage.removeItem(SESSION_KEY).catch(()=>{});
const loadHist   = async(pid:string):Promise<HistItem[]>  => {try{const r=await AsyncStorage.getItem(hKey(pid));return r?JSON.parse(r):[];}catch{return[];}};
const saveHist   = async(pid:string,l:HistItem[])         => AsyncStorage.setItem(hKey(pid),JSON.stringify(l)).catch(()=>{});
const loadAlerts = async(pid:string):Promise<AlertItem[]> => {try{const r=await AsyncStorage.getItem(aKey(pid));return r?JSON.parse(r):[];}catch{return[];}};
const saveAlerts = async(pid:string,l:AlertItem[])        => AsyncStorage.setItem(aKey(pid),JSON.stringify(l)).catch(()=>{});

const fetchWithTimeout=(url:string,options:RequestInit,ms=10000)=>{
  const ctrl=new AbortController();
  const id=setTimeout(()=>ctrl.abort(),ms);
  return fetch(url,{...options,signal:ctrl.signal}).finally(()=>clearTimeout(id));
};

const hapticHeavy=()=>{try{Haptics?.impactAsync(Haptics.ImpactFeedbackStyle?.Heavy);}catch{}};
const hapticLight=()=>{try{Haptics?.impactAsync(Haptics.ImpactFeedbackStyle?.Light);}catch{}};

// ═════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ═════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [screen,setScreen]           = useState<Screen>("onboard");
  const [session,setSession]         = useState<Account|null>(null);
  const [accounts,setAccounts]       = useState<Account[]>([]);
  const [history,setHistory]         = useState<HistItem[]>([]);
  const [alerts,setAlerts]           = useState<AlertItem[]>([]);
  const [parentTab,setParentTab]     = useState<ParentTab>("analyze");
  const [profileOpen,setProfileOpen] = useState(false);
  const [profileTab,setProfileTab]   = useState<"info"|"password"|"linked">("info");
  const [alertDrawer,setAlertDrawer] = useState(false);
  const [rec,setRec]                 = useState<Audio.Recording|null>(null);
  const [audioUri,setAudioUri]       = useState<string|null>(null);
  const [result,setResult]           = useState<Result|null>(null);
  const [loading,setLoading]         = useState(false);
  const [isRec,setIsRec]             = useState(false);
  const [liveRec,setLiveRec]         = useState<Audio.Recording|null>(null);
  const [isLive,setIsLive]           = useState(false);

  const pulse  = useRef(new Animated.Value(1)).current;
  const pulseR = useRef<Animated.CompositeAnimation|null>(null);
  const liveA  = useRef(new Animated.Value(1)).current;
  const liveR  = useRef<Animated.CompositeAnimation|null>(null);

  useEffect(()=>{
    (async()=>{
      const [accs,sess]=await Promise.all([loadAccs(),loadSess()]);
      setAccounts(accs);
      if(sess){
        setSession(sess);
        const pid=sess.role==="parent"?(sess as ParentAcc).parentId:(sess as ChildAcc).parentId;
        const [hist,alts]=await Promise.all([loadHist(pid),loadAlerts(pid)]);
        setHistory(hist);setAlerts(alts);
        setScreen(sess.role==="parent"?"parent_home":"child_home");
      }
    })();
  },[]);

  useEffect(()=>{
    if(isRec){pulseR.current=Animated.loop(Animated.sequence([Animated.timing(pulse,{toValue:1.1,duration:600,easing:Easing.inOut(Easing.ease),useNativeDriver:true}),Animated.timing(pulse,{toValue:1,duration:600,easing:Easing.inOut(Easing.ease),useNativeDriver:true})]));pulseR.current.start();}
    else{pulseR.current?.stop();pulse.setValue(1);}
  },[isRec]);

  useEffect(()=>{
    if(isLive){liveR.current=Animated.loop(Animated.sequence([Animated.timing(liveA,{toValue:1.18,duration:400,useNativeDriver:true}),Animated.timing(liveA,{toValue:0.92,duration:400,useNativeDriver:true})]));liveR.current.start();}
    else{liveR.current?.stop();liveA.setValue(1);}
  },[isLive]);

  const parentId=useMemo(()=>{if(!session)return"";return session.role==="parent"?(session as ParentAcc).parentId:(session as ChildAcc).parentId;},[session]);
  const unreadCount=useMemo(()=>alerts.filter(a=>!a.read).length,[alerts]);

  // ── Auth ──
  const doRegParent=useCallback(async(pn:string,em:string,cn:string,ca:string,notes:string,pw:string)=>{
    if(!pn.trim()||!pw.trim()||!cn.trim()){Alert.alert("Eksik","Ad, çocuk adı ve şifre zorunludur.");return;}
    const a:ParentAcc={role:"parent",parentId:genId("P-"),parentName:pn.trim(),email:em.trim(),childName:cn.trim(),childAge:ca.trim(),notes:notes.trim(),passwordHash:doHash(pw)};
    const u=[...accounts,a];setAccounts(u);await saveAccs(u);setSession(a);await saveSess(a);setHistory([]);setAlerts([]);setScreen("parent_home");
  },[accounts]);

  const doRegChild=useCallback(async(cn:string,pid:string,pw:string)=>{
    if(!cn.trim()||!pid.trim()||!pw.trim()){Alert.alert("Eksik","Ad, ebeveyn ID ve şifre zorunludur.");return;}
    const p=pid.trim().toUpperCase();
    if(!p.startsWith("P-")||p.length<5){Alert.alert("Geçersiz ID","Ebeveyn ID 'P-' ile başlar.");return;}
    const a:ChildAcc={role:"child",childId:genId("C-"),childName:cn.trim(),parentId:p,passwordHash:doHash(pw)};
    const u=[...accounts,a];setAccounts(u);await saveAccs(u);setSession(a);await saveSess(a);
    const [hist,alts]=await Promise.all([loadHist(p),loadAlerts(p)]);
    setHistory(hist);setAlerts(alts);setScreen("child_home");
  },[accounts]);

  const doLogin=useCallback(async(nameOrId:string,pw:string)=>{
    if(!nameOrId.trim()||!pw.trim()){Alert.alert("Eksik","Ad/ID ve şifre gerekli.");return;}
    const h=doHash(pw);
    const found=accounts.find(a=>{
      if(a.role==="parent"){const p=a as ParentAcc;return(p.parentName.toLowerCase()===nameOrId.toLowerCase()||p.parentId===nameOrId.trim().toUpperCase())&&p.passwordHash===h;}
      else{const c=a as ChildAcc;return c.childName.toLowerCase()===nameOrId.toLowerCase()&&c.passwordHash===h;}
    });
    if(!found){Alert.alert("Hatalı","Ad/ID veya şifre yanlış.");return;}
    setSession(found);await saveSess(found);
    const pid=found.role==="parent"?(found as ParentAcc).parentId:(found as ChildAcc).parentId;
    const [hist,alts]=await Promise.all([loadHist(pid),loadAlerts(pid)]);
    setHistory(hist);setAlerts(alts);setScreen(found.role==="parent"?"parent_home":"child_home");
  },[accounts]);

  const doLogout=useCallback(async()=>{
    setSession(null);await saveSess(null);setHistory([]);setAlerts([]);setResult(null);
    setAudioUri(null);setIsRec(false);setProfileOpen(false);setAlertDrawer(false);setScreen("auth");
  },[]);

  const doUpdateParent=useCallback(async(upd:Partial<ParentAcc>)=>{
    if(!session||session.role!=="parent")return;
    const na:ParentAcc={...(session as ParentAcc),...upd};
    const nl=accounts.map(a=>a.role==="parent"&&(a as ParentAcc).parentId===na.parentId?na:a);
    setAccounts(nl);setSession(na);await Promise.all([saveAccs(nl),saveSess(na)]);
  },[session,accounts]);

  const doChangePw=useCallback(async(oldPw:string,newPw:string)=>{
    if(!session||session.role!=="parent")return;
    const cur=session as ParentAcc;
    if(cur.passwordHash!==doHash(oldPw)){Alert.alert("Hatalı","Mevcut şifre yanlış.");return;}
    await doUpdateParent({passwordHash:doHash(newPw)});
    Alert.alert("Başarılı","Şifreniz güncellendi.");
  },[session,doUpdateParent]);

  // ── History ──
  const addItem=useCallback(async(r:Result)=>{
    const item:HistItem={id:`${Date.now()}-${Math.random().toString(36).slice(2,6)}`,createdAt:new Date().toISOString(),result:r};
    const upd=[item,...history];setHistory(upd);await saveHist(parentId,upd);
  },[history,parentId]);

  const clearHist=useCallback(()=>{
    Alert.alert("Geçmişi Sil","Tüm kayıtlar silinecek?",[{text:"İptal",style:"cancel"},{text:"Sil",style:"destructive",onPress:async()=>{setHistory([]);await saveHist(parentId,[]);}}]);
  },[parentId]);

  // ── Alerts ──
  const sendAlert=useCallback(async(level:AlertLevel,message:string,cAcc:ChildAcc)=>{
    const item:AlertItem={id:`ALT-${Date.now()}`,parentId:cAcc.parentId,childId:cAcc.childId,childName:cAcc.childName,level,message,createdAt:new Date().toISOString(),read:false};
    const existing=await loadAlerts(cAcc.parentId);
    const upd=[item,...existing];
    await saveAlerts(cAcc.parentId,upd);
    if(session?.role==="parent"&&(session as ParentAcc).parentId===cAcc.parentId) setAlerts(upd);
    hapticHeavy();
  },[session]);

  const markAlertRead=useCallback(async(id:string)=>{
    const upd=alerts.map(a=>a.id===id?{...a,read:true}:a);
    setAlerts(upd);await saveAlerts(parentId,upd);
  },[alerts,parentId]);

  const deleteAlert=useCallback(async(id:string)=>{
    const upd=alerts.filter(a=>a.id!==id);
    setAlerts(upd);await saveAlerts(parentId,upd);
  },[alerts,parentId]);

  const clearAlerts=useCallback(()=>{
    Alert.alert("Bildirimleri Sil","Tüm bildirimler silinecek?",[{text:"İptal",style:"cancel"},{text:"Sil",style:"destructive",onPress:async()=>{setAlerts([]);await saveAlerts(parentId,[]);}}]);
  },[parentId]);

  const handleParentTab=useCallback(async(t:ParentTab)=>{
    setParentTab(t);
    if(t==="alerts"){
      const upd=alerts.map(a=>({...a,read:true}));
      setAlerts(upd);await saveAlerts(parentId,upd);
    }
  },[alerts,parentId]);

  // ── Audio ──
  const startRec=useCallback(async()=>{
    if(isRec)return;
    const p=await Audio.requestPermissionsAsync();
    if(!p.granted){Alert.alert("İzin gerekli","Mikrofon izni olmadan kayıt yapılamaz.");return;}
    await Audio.setAudioModeAsync({allowsRecordingIOS:true,playsInSilentModeIOS:true});
    try{const{recording:r}=await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);setRec(r);setAudioUri(null);setResult(null);setIsRec(true);}
    catch{Alert.alert("Hata","Kayıt başlatılamadı.");}
  },[isRec]);

  const stopRec=useCallback(async()=>{
    if(!rec)return;
    try{await rec.stopAndUnloadAsync();setAudioUri(rec.getURI()??null);}catch{}
    setRec(null);setIsRec(false);
  },[rec]);

  const sendAudio=useCallback(async()=>{
    if(!audioUri){Alert.alert("Ses yok","Önce ses kaydet.");return;}
    setLoading(true);setResult(null);
    try{
      const fd=new FormData();
      fd.append("file",{uri:audioUri,name:"recording.m4a",type:"audio/m4a"} as any);
      const resp=await fetchWithTimeout(API_URL,{method:"POST",body:fd},10000);
      if(!resp.ok){const t=await resp.text().catch(()=>"");setResult({error:`Sunucu hatası: ${resp.status}${t?" — "+t.slice(0,80):""}`});return;}
      const data:Result=await resp.json();
      setResult(data);
      if(!data.error){
        await addItem(data);
        if(data.label&&session?.role==="child"){
          const emoInfo=EM[data.label as EmotionKey];
          if(emoInfo?.alertLevel){
            await sendAlert(emoInfo.alertLevel,`${(session as ChildAcc).childName} "${emoInfo.label}" duygusu tespit edildi. Güven: %${Math.round((data.confidence??0)*100)}`,session as ChildAcc);
          }
        }
      }
    }catch(err:any){
      if(err?.name==="AbortError")setResult({error:"Zaman aşımı: Sunucu 10 saniyede yanıt vermedi."});
      else setResult({error:`Bağlantı hatası: ${err?.message??"API'ye ulaşılamadı."}`});
    }finally{setLoading(false);}
  },[audioUri,addItem,session,sendAlert]);

  const resetRec=useCallback(()=>{setResult(null);setAudioUri(null);setIsRec(false);setRec(null);},[]);

  const toggleLive=useCallback(async()=>{
    if(isLive){try{await liveRec?.stopAndUnloadAsync();}catch{}setLiveRec(null);setIsLive(false);}
    else{
      const p=await Audio.requestPermissionsAsync();
      if(!p.granted){Alert.alert("İzin gerekli","Mikrofon izni gerekli.");return;}
      await Audio.setAudioModeAsync({allowsRecordingIOS:true,playsInSilentModeIOS:true});
      try{const{recording:r}=await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);setLiveRec(r);setIsLive(true);}
      catch{Alert.alert("Hata","Acil dinleme başlatılamadı.");}
    }
  },[isLive,liveRec]);

  const summary=useMemo(()=>{
    const cnt:Record<string,number>={NEUTRAL:0,SADNESS:0,HAPPY:0,ANGER:0};
    history.forEach(h=>{if(h.result.label&&cnt[h.result.label]!==undefined)cnt[h.result.label]++;});
    const max=Math.max(...Object.values(cnt),1);
    return EMO_ORDER.map(k=>({key:k,...EM[k],count:cnt[k],pct:cnt[k]===0?3:Math.max((cnt[k]/max)*100,6)}));
  },[history]);

  // ── Render ──
  if(screen==="onboard")    return <OnboardScreen onDone={()=>setScreen("auth")}/>;
  if(screen==="auth")       return <AuthScreen onLogin={()=>setScreen("login")} onRegParent={()=>setScreen("reg_parent")} onRegChild={()=>setScreen("reg_child")}/>;
  if(screen==="reg_parent") return <RegParentScreen onSubmit={doRegParent} onBack={()=>setScreen("auth")}/>;
  if(screen==="reg_child")  return <RegChildScreen  onSubmit={doRegChild}  onBack={()=>setScreen("auth")}/>;
  if(screen==="login")      return <LoginScreen onSubmit={doLogin} onBack={()=>setScreen("auth")}/>;

  if(screen==="parent_home"&&session?.role==="parent") return (
    <ParentHome
      account={session as ParentAcc} tab={parentTab} onTabChange={handleParentTab}
      profileOpen={profileOpen} profileTab={profileTab}
      onProfileOpen={()=>{setProfileTab("info");setProfileOpen(true);}} onProfileClose={()=>setProfileOpen(false)} onProfileTabChange={setProfileTab}
      alertDrawer={alertDrawer} onAlertDrawerOpen={()=>setAlertDrawer(true)} onAlertDrawerClose={()=>setAlertDrawer(false)}
      alerts={alerts} unreadCount={unreadCount}
      history={history} summary={summary}
      isRec={isRec} audioUri={audioUri} result={result} loading={loading}
      isLive={isLive} liveA={liveA} pulse={pulse}
      onStartRec={startRec} onStopRec={stopRec} onSendAudio={sendAudio} onReset={resetRec}
      onToggleLive={toggleLive} onClearHist={clearHist}
      onMarkAlertRead={markAlertRead} onDeleteAlert={deleteAlert} onClearAlerts={clearAlerts}
      onUpdateProfile={doUpdateParent} onChangePw={doChangePw} onLogout={doLogout}
    />
  );

  if(screen==="child_home"&&session?.role==="child") return (
    <ChildHome
      account={session as ChildAcc}
      profileOpen={profileOpen} onProfileOpen={()=>setProfileOpen(true)} onProfileClose={()=>setProfileOpen(false)}
      isRec={isRec} audioUri={audioUri} result={result} loading={loading} pulse={pulse}
      onStartRec={startRec} onStopRec={stopRec} onSendAudio={sendAudio} onReset={resetRec}
      onSendAlert={sendAlert} onLogout={doLogout}
    />
  );
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// ONBOARD
// ═════════════════════════════════════════════════════════════════════════════

function OnboardScreen({onDone}:{onDone:()=>void}) {
  const [step,setStep]=useState(0);
  const fadeA=useRef(new Animated.Value(1)).current;
  const slides=[
    {grad:["#6048E8","#8B78F0"] as [string,string],emoji:"🎙️",title:"Ses Analizi",body:"Konuşmanı kaydet, yapay zeka duygusal durumunu çözsün.",chip:"Sesle analiz"},
    {grad:["#2EB872","#5DD49A"] as [string,string],emoji:"👨‍👩‍👧",title:"Aile Bağı",body:"Ebeveynler çocuklarının duygu geçmişini takip edebilir.",chip:"Bağlı profiller"},
    {grad:["#E53935","#F0654A"] as [string,string],emoji:"🆘",title:"Acil Yardım",body:"Çocuğun tehlikede mi? 3 sn basılı tut — ebeveynine anında bildirim gider.",chip:"Anında bildirim"},
  ];
  const go=(n:number)=>{
    Animated.timing(fadeA,{toValue:0,duration:180,useNativeDriver:true}).start(()=>{
      setStep(n);Animated.timing(fadeA,{toValue:1,duration:260,useNativeDriver:true}).start();
    });
  };
  const s=slides[step];
  return (
    <View style={{flex:1}}>
      <StatusBar barStyle="light-content"/>
      <LinearGradient colors={s.grad} style={$ob.wrap}>
        <View style={[$ob.circle,{top:-80,right:-80,opacity:0.15}]}/>
        <View style={[$ob.circle,{bottom:120,left:-100,width:280,height:280,opacity:0.1}]}/>
        <View style={$ob.top}>
          <View style={$ob.logoRing}><Text style={$ob.logoStar}>✦</Text></View>
          <Text style={$ob.appName}>EmotiVoice</Text>
        </View>
        <Animated.View style={[$ob.slide,{opacity:fadeA}]}>
          <View style={$ob.emojiCard}><Text style={$ob.slideEmoji}>{s.emoji}</Text></View>
          <View style={$ob.chipWrap}><View style={$ob.chip}><Text style={$ob.chipText}>{s.chip}</Text></View></View>
          <Text style={$ob.slideTitle}>{s.title}</Text>
          <Text style={$ob.slideBody}>{s.body}</Text>
        </Animated.View>
        <View style={$ob.bottom}>
          <View style={$ob.dots}>
            {slides.map((_,i)=>(
              <TouchableOpacity key={i} onPress={()=>go(i)}>
                <View style={[$ob.dot,step===i&&{width:28,backgroundColor:"#fff"}]}/>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={$ob.btn} activeOpacity={0.85} onPress={()=>step<slides.length-1?go(step+1):onDone()}>
            <Text style={$ob.btnText}>{step<slides.length-1?"İleri →":"Başla"}</Text>
          </TouchableOpacity>
          {step<slides.length-1&&<TouchableOpacity onPress={onDone} style={{marginTop:12}}><Text style={$ob.skip}>Geç</Text></TouchableOpacity>}
        </View>
      </LinearGradient>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTH
// ═════════════════════════════════════════════════════════════════════════════

function AuthScreen({onLogin,onRegParent,onRegChild}:{onLogin:()=>void;onRegParent:()=>void;onRegChild:()=>void;}) {
  return (
    <SafeAreaView style={{flex:1,backgroundColor:T.bg}}>
      <StatusBar barStyle="dark-content" backgroundColor={T.bg}/>
      <ScrollView contentContainerStyle={$au.container}>
        <View style={$au.hero}>
          <LinearGradient colors={[T.primary,T.pLight]} style={$au.heroLogo}><Text style={$au.heroLogoText}>✦</Text></LinearGradient>
          <Text style={$au.heroTitle}>EmotiVoice</Text>
          <Text style={$au.heroSub}>Sesinizin ardındaki duyguyu keşfedin</Text>
          <View style={$au.heroPills}>
            {["🎤 Ses Analizi","📊 Geçmiş","🆘 Acil Yardım"].map(p=>(
              <View key={p} style={$au.pill}><Text style={$au.pillText}>{p}</Text></View>
            ))}
          </View>
        </View>
        <View style={$au.section}>
          <Text style={$au.sectionLabel}>GİRİŞ YAP</Text>
          <TouchableOpacity style={$au.card} activeOpacity={0.88} onPress={onLogin}>
            <View style={[$au.cardIcon,{backgroundColor:T.pBg}]}><Text style={{fontSize:22}}>👤</Text></View>
            <View style={$au.cardBody}><Text style={$au.cardTitle}>Mevcut Hesap</Text><Text style={$au.cardSub}>Hesabınla giriş yap</Text></View>
            <View style={[$au.cardChev,{backgroundColor:T.pBg}]}><Text style={{color:T.primary,fontWeight:"800"}}>›</Text></View>
          </TouchableOpacity>
        </View>
        <View style={$au.section}>
          <Text style={$au.sectionLabel}>YENİ HESAP OLUŞTUR</Text>
          <TouchableOpacity style={$au.card} activeOpacity={0.88} onPress={onRegParent}>
            <View style={[$au.cardIcon,{backgroundColor:T.greenBg}]}><Text style={{fontSize:22}}>👨‍👩‍👧</Text></View>
            <View style={$au.cardBody}><Text style={$au.cardTitle}>Ebeveyn Kaydı</Text><Text style={$au.cardSub}>Çocuğunuzu takip edin</Text></View>
            <View style={[$au.cardChev,{backgroundColor:T.greenBg}]}><Text style={{color:T.green,fontWeight:"800"}}>›</Text></View>
          </TouchableOpacity>
          <View style={{height:10}}/>
          <TouchableOpacity style={$au.card} activeOpacity={0.88} onPress={onRegChild}>
            <View style={[$au.cardIcon,{backgroundColor:T.amberBg}]}><Text style={{fontSize:22}}>🧒</Text></View>
            <View style={$au.cardBody}><Text style={$au.cardTitle}>Çocuk Kaydı</Text><Text style={$au.cardSub}>Duygularını keşfet</Text></View>
            <View style={[$au.cardChev,{backgroundColor:T.amberBg}]}><Text style={{color:T.amber,fontWeight:"800"}}>›</Text></View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// REGISTER / LOGIN
// ═════════════════════════════════════════════════════════════════════════════

function RegParentScreen({onSubmit,onBack}:{onSubmit:(pn:string,em:string,cn:string,ca:string,notes:string,pw:string)=>void;onBack:()=>void;}) {
  const [pn,setPn]=useState("");const [em,setEm]=useState("");const [cn,setCn]=useState("");
  const [ca,setCa]=useState("");const [notes,setNotes]=useState("");const [pw,setPw]=useState("");const [pw2,setPw2]=useState("");
  return (
    <FormShell title="Ebeveyn Kaydı" subtitle="Çocuğunuzun profilini oluşturun" accent={T.green} onBack={onBack}>
      <FGroup label="KİŞİSEL BİLGİLER">
        <FInput label="Adınız *" value={pn} onChange={setPn} ph="Ali Yılmaz"/>
        <FInput label="E-posta"  value={em} onChange={setEm} ph="ali@mail.com" kb="email-address"/>
      </FGroup>
      <FGroup label="ÇOCUK BİLGİLERİ">
        <FInput label="Çocuğun Adı *" value={cn}    onChange={setCn}    ph="Ayşe"/>
        <FInput label="Çocuğun Yaşı"  value={ca}    onChange={setCa}    ph="8" kb="numeric"/>
        <FInput label="Notlar"         value={notes} onChange={setNotes} ph="Özel durumlar, tanılar..." multi/>
      </FGroup>
      <FGroup label="GÜVENLİK">
        <FInput label="Şifre *"        value={pw}  onChange={setPw}  ph="En az 4 karakter" secure/>
        <FInput label="Şifre Tekrar *" value={pw2} onChange={setPw2} ph="Tekrarla" secure/>
      </FGroup>
      <ActBtn label="Hesabı Oluştur" accent={T.green} onPress={()=>{if(pw!==pw2){Alert.alert("Uyuşmuyor","İki şifre aynı olmalı.");return;}onSubmit(pn,em,cn,ca,notes,pw);}}/>
    </FormShell>
  );
}

function RegChildScreen({onSubmit,onBack}:{onSubmit:(cn:string,pid:string,pw:string)=>void;onBack:()=>void;}) {
  const [cn,setCn]=useState("");const [pid,setPid]=useState("");const [pw,setPw]=useState("");const [pw2,setPw2]=useState("");
  return (
    <FormShell title="Çocuk Kaydı" subtitle="Ebeveynin ID'siyle bağlan" accent={T.amber} onBack={onBack}>
      <FGroup label="BİLGİLERİN">
        <FInput label="Adın *"       value={cn}  onChange={setCn}  ph="Adın"/>
        <FInput label="Ebeveyn ID *" value={pid} onChange={v=>setPid(v.toUpperCase())} ph="P-XXXXXX" autoCapitalize="characters"/>
        <View style={{backgroundColor:T.pBg,borderRadius:12,padding:12}}>
          <Text style={{color:T.primary,fontSize:13,lineHeight:19}}>📱 Ebeveyn ID'yi ebeveyninin profilinde bulabilirsin.</Text>
        </View>
      </FGroup>
      <FGroup label="GÜVENLİK">
        <FInput label="Şifre *"          value={pw}  onChange={setPw}  ph="En az 4 karakter" secure/>
        <FInput label="Şifre Tekrar *"   value={pw2} onChange={setPw2} ph="Tekrarla" secure/>
      </FGroup>
      <ActBtn label="Hesabı Oluştur" accent={T.amber} onPress={()=>{if(pw!==pw2){Alert.alert("Uyuşmuyor","İki şifre aynı olmalı.");return;}onSubmit(cn,pid,pw);}}/>
    </FormShell>
  );
}

function LoginScreen({onSubmit,onBack}:{onSubmit:(n:string,pw:string)=>void;onBack:()=>void;}) {
  const [n,setN]=useState("");const [pw,setPw]=useState("");
  return (
    <FormShell title="Tekrar Hoş Geldin" subtitle="Ad veya Ebeveyn ID ile giriş yap" accent={T.primary} onBack={onBack}>
      <FGroup label="GİRİŞ BİLGİLERİ">
        <FInput label="Ad veya Ebeveyn ID" value={n}  onChange={setN}  ph="Adın ya da P-XXXXXX"/>
        <FInput label="Şifre"              value={pw} onChange={setPw} ph="Şifren" secure/>
      </FGroup>
      <ActBtn label="Giriş Yap" accent={T.primary} onPress={()=>onSubmit(n,pw)}/>
    </FormShell>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// PARENT HOME
// ═════════════════════════════════════════════════════════════════════════════

function ParentHome({
  account,tab,onTabChange,profileOpen,profileTab,onProfileOpen,onProfileClose,onProfileTabChange,
  alertDrawer,onAlertDrawerOpen,onAlertDrawerClose,alerts,unreadCount,
  history,summary,isRec,audioUri,result,loading,isLive,liveA,pulse,
  onStartRec,onStopRec,onSendAudio,onReset,onToggleLive,onClearHist,
  onMarkAlertRead,onDeleteAlert,onClearAlerts,
  onUpdateProfile,onChangePw,onLogout,
}:{
  account:ParentAcc;tab:ParentTab;onTabChange:(t:ParentTab)=>void;
  profileOpen:boolean;profileTab:"info"|"password"|"linked";
  onProfileOpen:()=>void;onProfileClose:()=>void;onProfileTabChange:(t:"info"|"password"|"linked")=>void;
  alertDrawer:boolean;onAlertDrawerOpen:()=>void;onAlertDrawerClose:()=>void;
  alerts:AlertItem[];unreadCount:number;
  history:HistItem[];summary:any[];
  isRec:boolean;audioUri:string|null;result:Result|null;loading:boolean;
  isLive:boolean;liveA:Animated.Value;pulse:Animated.Value;
  onStartRec:()=>void;onStopRec:()=>void;onSendAudio:()=>void;onReset:()=>void;
  onToggleLive:()=>void;onClearHist:()=>void;
  onMarkAlertRead:(id:string)=>void;onDeleteAlert:(id:string)=>void;onClearAlerts:()=>void;
  onUpdateProfile:(p:Partial<ParentAcc>)=>void;onChangePw:(o:string,n:string)=>void;onLogout:()=>void;
}) {
  const badgePulse=useRef(new Animated.Value(1)).current;
  useEffect(()=>{
    if(unreadCount>0){
      const a=Animated.loop(Animated.sequence([Animated.timing(badgePulse,{toValue:1.35,duration:500,useNativeDriver:true}),Animated.timing(badgePulse,{toValue:1,duration:500,useNativeDriver:true})]));
      a.start();return ()=>a.stop();
    } else badgePulse.setValue(1);
  },[unreadCount]);

  return (
    <SafeAreaView style={{flex:1,backgroundColor:T.bg}}>
      <StatusBar barStyle="dark-content" backgroundColor={T.bg}/>

      {/* ── Top bar ── */}
      <View style={$ph.bar}>
        <View>
          <Text style={$ph.greeting}>Merhaba, {account.parentName.split(" ")[0]} 👋</Text>
          <Text style={$ph.sub}>{account.childName} için panel</Text>
        </View>
        <View style={{flexDirection:"row",gap:10,alignItems:"center"}}>
          {isLive&&(
            <Animated.View style={[$ph.livePill,{transform:[{scale:liveA}]}]}>
              <Text style={$ph.livePillTxt}>🔴 CANLI</Text>
            </Animated.View>
          )}
          {/* Bildirim zili */}
          <TouchableOpacity onPress={onAlertDrawerOpen} activeOpacity={0.85} style={{padding:4}}>
            <Text style={{fontSize:24}}>🔔</Text>
            {unreadCount>0&&(
              <Animated.View style={[$ph.badge,{transform:[{scale:badgePulse}]}]}>
                <Text style={$ph.badgeTxt}>{unreadCount>9?"9+":unreadCount}</Text>
              </Animated.View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={onProfileOpen} activeOpacity={0.85}>
            <LinearGradient colors={[T.primary,T.pLight]} style={$ph.ava}>
              <Text style={$ph.avaText}>{initials(account.parentName)}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Tabs ── */}
      <View style={$ph.tabs}>
        {(["analyze","history","alerts"] as ParentTab[]).map(t=>(
          <TouchableOpacity key={t} style={[$ph.tab,tab===t&&{borderBottomColor:T.primary,borderBottomWidth:2.5}]} onPress={()=>onTabChange(t)}>
            <View style={{flexDirection:"row",alignItems:"center",gap:4}}>
              <Text style={[$ph.tabTxt,tab===t&&{color:T.primary,fontWeight:"800"}]}>
                {t==="analyze"?"🔬 Analiz":t==="history"?"📊 Geçmiş":"🚨 Bildirim"}
              </Text>
              {t==="alerts"&&unreadCount>0&&(
                <View style={{backgroundColor:T.red,borderRadius:999,minWidth:16,height:16,alignItems:"center",justifyContent:"center",paddingHorizontal:3}}>
                  <Text style={{color:"#fff",fontSize:9,fontWeight:"900"}}>{unreadCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Content ── */}
      <View style={{flex:1}}>
        {tab==="analyze"&&<ParentAnalyze childName={account.childName} isRec={isRec} audioUri={audioUri} result={result} loading={loading} isLive={isLive} liveA={liveA} pulse={pulse} onStartRec={onStartRec} onStopRec={onStopRec} onSendAudio={onSendAudio} onReset={onReset} onToggleLive={onToggleLive}/>}
        {tab==="history"&&<ParentHistory history={history} summary={summary} onClear={onClearHist}/>}
        {tab==="alerts"&&<AlertsTab alerts={alerts} onMarkRead={onMarkAlertRead} onDelete={onDeleteAlert} onClearAll={onClearAlerts}/>}
      </View>

      {/* ── Alert Drawer (zil simgesiyle açılan) ── */}
      {alertDrawer&&(
        <>
          <Pressable style={$pd.backdrop} onPress={onAlertDrawerClose}/>
          <AlertsDrawer alerts={alerts.slice(0,6)} onMarkRead={onMarkAlertRead} onDelete={onDeleteAlert} onClearAll={onClearAlerts} onClose={onAlertDrawerClose}/>
        </>
      )}

      {/* ── Profile Dropdown ── */}
      {profileOpen&&(
        <>
          <Pressable style={$pd.backdrop} onPress={onProfileClose}/>
          <ProfileDropdown account={account} tab={profileTab} onTabChange={onProfileTabChange} onUpdateProfile={onUpdateProfile} onChangePw={onChangePw} onLogout={()=>{onProfileClose();onLogout();}} onClose={onProfileClose}/>
        </>
      )}
    </SafeAreaView>
  );
}

// ─── Alerts Tab ───────────────────────────────────────────────────────────────

function AlertsTab({alerts,onMarkRead,onDelete,onClearAll}:{alerts:AlertItem[];onMarkRead:(id:string)=>void;onDelete:(id:string)=>void;onClearAll:()=>void;}) {
  return (
    <ScrollView contentContainerStyle={{padding:16,gap:12,paddingBottom:48}} showsVerticalScrollIndicator={false}>
      <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <Text style={{fontSize:16,fontWeight:"900",color:T.ink}}>Tüm Bildirimler</Text>
        {alerts.length>0&&<TouchableOpacity onPress={onClearAll}><Text style={{color:T.red,fontWeight:"700",fontSize:13}}>Temizle</Text></TouchableOpacity>}
      </View>
      {alerts.length===0?(
        <View style={{alignItems:"center",paddingVertical:48,gap:10}}>
          <Text style={{fontSize:40}}>🔕</Text>
          <Text style={{color:T.inkMid,fontWeight:"700",fontSize:15}}>Bildirim yok</Text>
          <Text style={{color:T.inkLight,fontSize:13,textAlign:"center",lineHeight:20}}>Çocuğun acil butonuna bastığında{"\n"}veya olumsuz duygu tespit edildiğinde{"\n"}burada görünür</Text>
        </View>
      ):alerts.map(a=><AlertCard key={a.id} item={a} onMarkRead={onMarkRead} onDelete={onDelete}/>)}
    </ScrollView>
  );
}

function AlertCard({item,onMarkRead,onDelete}:{item:AlertItem;onMarkRead:(id:string)=>void;onDelete:(id:string)=>void;}) {
  const meta=ALERT_META[item.level];
  return (
    <View style={[$alc.card,{backgroundColor:item.read?T.bgCard:meta.bg,borderLeftWidth:4,borderLeftColor:meta.color,borderColor:meta.border}]}>
      <View style={$alc.row}>
        <View style={[$alc.icon,{backgroundColor:meta.bg}]}><Text style={{fontSize:20}}>{meta.emoji}</Text></View>
        <View style={{flex:1,gap:2}}>
          <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}>
            <Text style={[$alc.level,{color:meta.color}]}>{meta.label}</Text>
            {!item.read&&<View style={{backgroundColor:meta.color,borderRadius:999,width:8,height:8}}/>}
          </View>
          <Text style={$alc.msg} numberOfLines={3}>{item.message}</Text>
          <Text style={$alc.time}>{item.childName} · {fmtDate(item.createdAt)}</Text>
        </View>
      </View>
      <View style={$alc.actions}>
        {!item.read&&(
          <TouchableOpacity style={[$alc.actionBtn,{backgroundColor:T.greenBg}]} onPress={()=>onMarkRead(item.id)}>
            <Text style={{color:T.green,fontWeight:"700",fontSize:12}}>✓ Okundu</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[$alc.actionBtn,{backgroundColor:T.redBg}]} onPress={()=>onDelete(item.id)}>
          <Text style={{color:T.red,fontWeight:"700",fontSize:12}}>🗑 Sil</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AlertsDrawer({alerts,onMarkRead,onDelete,onClearAll,onClose}:{alerts:AlertItem[];onMarkRead:(id:string)=>void;onDelete:(id:string)=>void;onClearAll:()=>void;onClose:()=>void;}) {
  return (
    <View style={$alc.drawer}>
      <View style={$alc.drawerHeader}>
        <Text style={{fontSize:15,fontWeight:"900",color:T.ink}}>🔔 Bildirimler</Text>
        <View style={{flexDirection:"row",gap:12,alignItems:"center"}}>
          {alerts.length>0&&<TouchableOpacity onPress={onClearAll}><Text style={{color:T.red,fontWeight:"700",fontSize:12}}>Temizle</Text></TouchableOpacity>}
          <TouchableOpacity style={$pd.closeBtn} onPress={onClose}><Text style={{color:T.inkMid,fontSize:16,fontWeight:"700"}}>✕</Text></TouchableOpacity>
        </View>
      </View>
      <ScrollView style={{maxHeight:380}} contentContainerStyle={{padding:12,gap:10}} showsVerticalScrollIndicator={false}>
        {alerts.length===0?(
          <View style={{alignItems:"center",paddingVertical:24,gap:8}}>
            <Text style={{fontSize:32}}>🔕</Text>
            <Text style={{color:T.inkMid,fontWeight:"700"}}>Henüz bildirim yok</Text>
          </View>
        ):alerts.map(a=><AlertCard key={a.id} item={a} onMarkRead={onMarkRead} onDelete={onDelete}/>)}
      </ScrollView>
    </View>
  );
}

// ─── Parent Analyze ───────────────────────────────────────────────────────────

function ParentAnalyze({childName,isRec,audioUri,result,loading,isLive,liveA,pulse,onStartRec,onStopRec,onSendAudio,onReset,onToggleLive}:{
  childName:string;isRec:boolean;audioUri:string|null;result:Result|null;
  loading:boolean;isLive:boolean;liveA:Animated.Value;pulse:Animated.Value;
  onStartRec:()=>void;onStopRec:()=>void;onSendAudio:()=>void;onReset:()=>void;onToggleLive:()=>void;
}) {
  const emoKey=result?.label as EmotionKey|undefined;
  const emo=emoKey?EM[emoKey]:null;
  const scores=useMemo(()=>{const s=result?.scores??{};return EMO_ORDER.map(k=>({key:k,...EM[k],pct:Math.round(Number(s[k]??0)*100)}));},[result]);
  const showRecCard=!loading&&!emo;
  return (
    <ScrollView contentContainerStyle={$pa.wrap} showsVerticalScrollIndicator={false}>
      <TouchableOpacity onPress={onToggleLive} activeOpacity={0.88}>
        <View style={[$pa.liveCard,isLive&&{borderColor:T.red,backgroundColor:T.redBg}]}>
          <Animated.View style={[{transform:[{scale:isLive?liveA:1}]},isLive&&{backgroundColor:T.red,borderRadius:16,padding:10}]}>
            <Text style={{fontSize:26}}>{isLive?"📡":"⚡"}</Text>
          </Animated.View>
          <View style={{flex:1}}>
            <Text style={[$pa.liveTitle,isLive&&{color:T.red}]}>{isLive?"Canlı Dinleme Aktif":"Acil Dinleme"}</Text>
            <Text style={$pa.liveSub}>{isLive?"Durdurmak için dokun":"Ortamı gerçek zamanlı dinle"}</Text>
          </View>
          <View style={[$pa.liveBadge,{backgroundColor:isLive?T.red:T.coralBg}]}>
            <Text style={{color:isLive?"#fff":T.coral,fontSize:11,fontWeight:"800"}}>{isLive?"AKTİF":"HAZIR"}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {showRecCard&&(
        <View style={$pa.recCard}>
          <Text style={$pa.recHeading}>🎤 {childName} için ses al</Text>
          <View style={$pa.recRow}>
            <Animated.View style={{transform:[{scale:pulse}]}}>
              <TouchableOpacity onPress={isRec?onStopRec:onStartRec} activeOpacity={0.85}>
                <LinearGradient colors={isRec?[T.red,T.coral]:[T.primary,T.pLight]} style={$pa.micBtn}>
                  <Text style={{fontSize:28}}>{isRec?"⏹":"🎤"}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
            <View style={{flex:1,gap:4}}>
              <Text style={$pa.recStatus}>{isRec?"Kaydediliyor…":"Hazır"}</Text>
              {isRec&&<View style={$pa.recDot}><View style={$pa.recDotInner}/><Text style={{fontSize:13,color:T.red,fontWeight:"700"}}>AKTİF</Text></View>}
              {audioUri&&!isRec&&<Text style={{fontSize:13,color:T.green,fontWeight:"700"}}>✓ Ses hazır</Text>}
              {!isRec&&!audioUri&&<Text style={{fontSize:13,color:T.inkLight}}>Butona dokunarak başla</Text>}
            </View>
          </View>
          {audioUri&&!isRec&&(
            <TouchableOpacity style={[$pa.analyzeBtn,{backgroundColor:T.primary}]} onPress={onSendAudio}>
              <Text style={{color:"#fff",fontWeight:"900",fontSize:15}}>✨ Analiz Et</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {loading&&<View style={$pa.loadCard}><Text style={{fontSize:38}}>🔍</Text><Text style={{fontSize:16,fontWeight:"700",color:T.inkMid,marginTop:8}}>Analiz ediliyor…</Text></View>}

      {emo&&!loading&&(
        <>
          <LinearGradient colors={emo.grad} style={[$pa.resultHero,{borderColor:emo.border,borderWidth:1.5}]}>
            <Text style={{fontSize:52}}>{emo.emoji}</Text>
            <Text style={[$pa.resultLabel,{color:emo.color}]}>{emo.label}</Text>
            <Text style={{fontSize:13,color:T.inkMid,fontWeight:"600"}}>Güven {typeof result?.confidence==="number"?`%${Math.round(result.confidence*100)}`:"—"}{result?.is_anomaly?"  ⚠️":""}</Text>
          </LinearGradient>
          {scores.map(item=>(
            <View key={item.key} style={$pa.scoreRow}>
              <Text style={{fontSize:18,width:28}}>{item.emoji}</Text>
              <View style={{flex:1,gap:4}}>
                <View style={{flexDirection:"row",justifyContent:"space-between"}}>
                  <Text style={{fontSize:14,fontWeight:"700",color:T.ink}}>{item.label}</Text>
                  <Text style={{fontSize:14,fontWeight:"900",color:item.color}}>{item.pct}%</Text>
                </View>
                <View style={$pa.trackBg}><View style={[$pa.trackFill,{width:`${Math.max(item.pct,2)}%`,backgroundColor:item.color}]}/></View>
              </View>
            </View>
          ))}
          <TouchableOpacity style={$pa.retryBtn} onPress={onReset}><Text style={{color:T.inkMid,fontWeight:"700",fontSize:14}}>🔄 Yeni Kayıt</Text></TouchableOpacity>
        </>
      )}

      {result?.error&&!loading&&(
        <View style={{gap:10}}>
          <View style={{backgroundColor:T.redBg,borderRadius:14,padding:14,borderWidth:1,borderColor:T.red+"44"}}>
            <Text style={{color:T.red,fontWeight:"700",lineHeight:20}}>⚠️ {result.error}</Text>
          </View>
          {audioUri&&<TouchableOpacity style={[$pa.analyzeBtn,{backgroundColor:T.amber}]} onPress={onSendAudio}><Text style={{color:"#fff",fontWeight:"900",fontSize:15}}>🔁 Tekrar Dene</Text></TouchableOpacity>}
          <TouchableOpacity style={$pa.retryBtn} onPress={onReset}><Text style={{color:T.inkMid,fontWeight:"700",fontSize:14}}>🎤 Yeni Kayıt Yap</Text></TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Parent History ───────────────────────────────────────────────────────────

function ParentHistory({history,summary,onClear}:{history:HistItem[];summary:any[];onClear:()=>void;}) {
  return (
    <ScrollView contentContainerStyle={$hi.wrap} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={[T.primary,T.pLight]} style={$hi.sumCard}>
        <Text style={$hi.sumTitle}>Duygu Özeti</Text>
        <Text style={$hi.sumSub}>{history.length} analiz</Text>
        {summary.map(item=>(
          <View key={item.key} style={$hi.sumRow}>
            <Text style={{fontSize:16,width:24}}>{item.emoji}</Text>
            <View style={$hi.sumTrack}><View style={[$hi.sumFill,{width:`${item.pct}%`,backgroundColor:"rgba(255,255,255,0.8)"}]}/></View>
            <Text style={$hi.sumCnt}>{item.count}</Text>
          </View>
        ))}
      </LinearGradient>
      <View style={$hi.listHead}>
        <Text style={$hi.listTitle}>Tüm Kayıtlar</Text>
        {history.length>0&&<TouchableOpacity onPress={onClear}><Text style={{color:T.red,fontWeight:"700",fontSize:13}}>Temizle</Text></TouchableOpacity>}
      </View>
      {history.length===0?(
        <View style={$hi.empty}><Text style={{fontSize:36}}>📭</Text><Text style={{color:T.inkMid,fontWeight:"700",marginTop:8}}>Henüz analiz yok</Text></View>
      ):history.map(item=>{
        const emo=EM[item.result.label as EmotionKey]??EM.NEUTRAL;
        const sc=item.result.scores??{};
        return (
          <View key={item.id} style={$hi.card}>
            <View style={$hi.cardTop}>
              <View style={[$hi.badge,{backgroundColor:emo.bg,borderColor:emo.border,borderWidth:1}]}>
                <Text style={{fontSize:14}}>{emo.emoji}</Text>
                <Text style={[$hi.badgeLabel,{color:emo.color}]}>{emo.label}</Text>
              </View>
              <Text style={{fontSize:11,color:T.inkLight,fontWeight:"600"}}>{fmtDate(item.createdAt)}</Text>
            </View>
            <Text style={{fontSize:12,color:T.inkLight,marginBottom:10}}>Güven: {typeof item.result.confidence==="number"?`%${Math.round(item.result.confidence*100)}`:"—"}{item.result.is_anomaly?" ⚠️":""}</Text>
            {EMO_ORDER.map(k=>{
              const pct=Math.round(Number(sc[k]??0)*100);
              return (
                <View key={k} style={{flexDirection:"row",alignItems:"center",gap:8,marginBottom:5}}>
                  <Text style={{fontSize:13,width:18}}>{EM[k].emoji}</Text>
                  <View style={{flex:1,height:6,backgroundColor:T.surface,borderRadius:999,overflow:"hidden"}}>
                    <View style={{width:`${Math.max(pct,2)}%`,height:"100%",backgroundColor:EM[k].color,borderRadius:999}}/>
                  </View>
                  <Text style={{width:30,textAlign:"right",fontSize:11,fontWeight:"700",color:EM[k].color}}>{pct}%</Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// PROFILE DROPDOWNS
// ═════════════════════════════════════════════════════════════════════════════

function ProfileDropdown({account,tab,onTabChange,onUpdateProfile,onChangePw,onLogout,onClose}:{
  account:ParentAcc;tab:"info"|"password"|"linked";
  onTabChange:(t:"info"|"password"|"linked")=>void;
  onUpdateProfile:(p:Partial<ParentAcc>)=>void;onChangePw:(o:string,n:string)=>void;
  onLogout:()=>void;onClose:()=>void;
}) {
  const [pn,setPn]=useState(account.parentName);const [em,setEm]=useState(account.email);
  const [cn,setCn]=useState(account.childName);const [ca,setCa]=useState(account.childAge);
  const [notes,setNotes]=useState(account.notes);
  const [oldPw,setOldPw]=useState("");const [newPw,setNewPw]=useState("");const [newPw2,setNewPw2]=useState("");
  const [saved,setSaved]=useState(false);
  return (
    <View style={$pd.dropdown}>
      <View style={$pd.arrow}/>
      <View style={$pd.header}>
        <LinearGradient colors={[T.primary,T.pLight]} style={$pd.ava}><Text style={$pd.avaText}>{initials(account.parentName)}</Text></LinearGradient>
        <View style={{flex:1}}><Text style={$pd.name}>{account.parentName}</Text><Text style={$pd.email}>{account.email||"Ebeveyn hesabı"}</Text></View>
        <TouchableOpacity style={$pd.closeBtn} onPress={onClose}><Text style={{color:T.inkMid,fontSize:16,fontWeight:"700"}}>✕</Text></TouchableOpacity>
      </View>
      <View style={$pd.tabs}>
        {(["info","password","linked"] as const).map(t=>(
          <TouchableOpacity key={t} style={[$pd.tabBtn,tab===t&&{borderBottomColor:T.primary,borderBottomWidth:2}]} onPress={()=>onTabChange(t)}>
            <Text style={[$pd.tabTxt,tab===t&&{color:T.primary,fontWeight:"800"}]}>{t==="info"?"Bilgilerim":t==="password"?"Şifre":"Bağlı"}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView style={{maxHeight:320}} contentContainerStyle={{padding:16,gap:10}} showsVerticalScrollIndicator={false}>
        {tab==="info"&&(
          <>
            <FInput label="Ad Soyad" value={pn} onChange={v=>{setPn(v);setSaved(false)}} ph="Adınız"/>
            <FInput label="E-posta"  value={em} onChange={v=>{setEm(v);setSaved(false)}} ph="mail@example.com" kb="email-address"/>
            <FInput label="Çocuğun Adı" value={cn} onChange={v=>{setCn(v);setSaved(false)}} ph="Çocuğun adı"/>
            <FInput label="Yaş" value={ca} onChange={v=>{setCa(v);setSaved(false)}} ph="8" kb="numeric"/>
            <FInput label="Notlar" value={notes} onChange={v=>{setNotes(v);setSaved(false)}} ph="Özel durumlar…" multi/>
            <TouchableOpacity style={[$pd.saveBtn,{backgroundColor:saved?T.green:T.primary}]} onPress={()=>{onUpdateProfile({parentName:pn,email:em,childName:cn,childAge:ca,notes});setSaved(true);}}>
              <Text style={$pd.saveBtnTxt}>{saved?"✓ Kaydedildi":"Kaydet"}</Text>
            </TouchableOpacity>
          </>
        )}
        {tab==="password"&&(
          <>
            <FInput label="Mevcut Şifre" value={oldPw} onChange={setOldPw} ph="Mevcut şifre" secure/>
            <FInput label="Yeni Şifre" value={newPw} onChange={setNewPw} ph="Yeni şifre" secure/>
            <FInput label="Yeni Şifre Tekrar" value={newPw2} onChange={setNewPw2} ph="Tekrarla" secure/>
            <TouchableOpacity style={[$pd.saveBtn,{backgroundColor:T.coral}]} onPress={()=>{if(newPw!==newPw2){Alert.alert("Uyuşmuyor","Yeni şifreler aynı olmalı.");return;}onChangePw(oldPw,newPw);setOldPw("");setNewPw("");setNewPw2("");}}>
              <Text style={$pd.saveBtnTxt}>Şifreyi Güncelle</Text>
            </TouchableOpacity>
          </>
        )}
        {tab==="linked"&&(
          <View style={{gap:12}}>
            <View style={$pd.linkedCard}>
              <Text style={{fontSize:36}}>🧒</Text>
              <Text style={{fontSize:18,fontWeight:"900",color:T.ink}}>{account.childName}</Text>
              {account.childAge?<Text style={{color:T.inkMid,fontSize:14}}>{account.childAge} yaşında</Text>:null}
              {account.notes?<Text style={{color:T.inkLight,fontSize:13,textAlign:"center",fontStyle:"italic"}}>{account.notes}</Text>:null}
            </View>
            <View style={$pd.idBox}>
              <Text style={$pd.idLabel}>Ebeveyn ID · Çocuk cihazına bu kodu girin</Text>
              <Text style={$pd.idValue}>{account.parentId}</Text>
            </View>
          </View>
        )}
        <View style={{height:8}}/>
        <TouchableOpacity style={$pd.logoutBtn} onPress={onLogout}><Text style={{color:T.red,fontWeight:"800",fontSize:14}}>🚪 Çıkış Yap</Text></TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function ChildProfileDropdown({account,onLogout,onClose}:{account:ChildAcc;onLogout:()=>void;onClose:()=>void;}) {
  return (
    <View style={$pd.dropdown}>
      <View style={$pd.arrow}/>
      <View style={$pd.header}>
        <LinearGradient colors={[T.amber,T.coral]} style={$pd.ava}><Text style={$pd.avaText}>{initials(account.childName)}</Text></LinearGradient>
        <View style={{flex:1}}><Text style={$pd.name}>{account.childName}</Text><Text style={$pd.email}>Çocuk Hesabı</Text></View>
        <TouchableOpacity style={$pd.closeBtn} onPress={onClose}><Text style={{color:T.inkMid,fontSize:16,fontWeight:"700"}}>✕</Text></TouchableOpacity>
      </View>
      <ScrollView style={{maxHeight:260}} contentContainerStyle={{padding:16,gap:12}} showsVerticalScrollIndicator={false}>
        <View style={$pd.linkedCard}><Text style={{fontSize:36}}>👤</Text><Text style={{fontSize:18,fontWeight:"900",color:T.ink}}>{account.childName}</Text></View>
        <View style={$pd.idBox}><Text style={$pd.idLabel}>Hesap ID</Text><Text style={$pd.idValue}>{account.childId}</Text></View>
        <View style={$pd.idBox}><Text style={$pd.idLabel}>Bağlı Ebeveyn ID</Text><Text style={$pd.idValue}>{account.parentId}</Text></View>
        <View style={{height:8}}/>
        <TouchableOpacity style={$pd.logoutBtn} onPress={onLogout}><Text style={{color:T.red,fontWeight:"800",fontSize:14}}>🚪 Çıkış Yap</Text></TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CHILD HOME  ──  ACİL BUTON + BİLDİRİM SİSTEMİ
// ═════════════════════════════════════════════════════════════════════════════

function ChildHome({
  account,profileOpen,onProfileOpen,onProfileClose,
  isRec,audioUri,result,loading,pulse,
  onStartRec,onStopRec,onSendAudio,onReset,onSendAlert,onLogout,
}:{
  account:ChildAcc;profileOpen:boolean;onProfileOpen:()=>void;onProfileClose:()=>void;
  isRec:boolean;audioUri:string|null;result:Result|null;loading:boolean;pulse:Animated.Value;
  onStartRec:()=>void;onStopRec:()=>void;onSendAudio:()=>void;onReset:()=>void;
  onSendAlert:(level:AlertLevel,msg:string,acc:ChildAcc)=>Promise<void>;
  onLogout:()=>void;
}) {
  const emoKey=result?.label as EmotionKey|undefined;
  const emo=emoKey?EM[emoKey]:null;

  // ── Acil buton state ──────────────────────────────────────────────────────
  const [emergencySent,setEmergencySent] = useState(false);
  const [isHolding,setIsHolding]         = useState(false);
  const [holdPct,setHoldPct]             = useState(0);   // 0-100
  const holdAnim    = useRef(new Animated.Value(0)).current;
  const holdAnimRef = useRef<Animated.CompositeAnimation|null>(null);
  const holdTimeout = useRef<ReturnType<typeof setTimeout>|null>(null);
  const emgPulse    = useRef(new Animated.Value(1)).current;

  // Kırmızı butonun sürekli hafif nabzı
  useEffect(()=>{
    const a=Animated.loop(Animated.sequence([
      Animated.timing(emgPulse,{toValue:1.07,duration:900,easing:Easing.inOut(Easing.ease),useNativeDriver:true}),
      Animated.timing(emgPulse,{toValue:1,duration:900,easing:Easing.inOut(Easing.ease),useNativeDriver:true}),
    ]));
    a.start();
    return ()=>a.stop();
  },[]);

  // 3 sn dolum animasyonu
  useEffect(()=>{
    if(isHolding){
      holdAnim.setValue(0);
      holdAnimRef.current=Animated.timing(holdAnim,{toValue:1,duration:3000,useNativeDriver:false});
      holdAnimRef.current.start();
      const listener=holdAnim.addListener(({value})=>setHoldPct(Math.round(value*100)));
      return ()=>{holdAnim.removeListener(listener);};
    } else {
      holdAnimRef.current?.stop();
      Animated.timing(holdAnim,{toValue:0,duration:200,useNativeDriver:false}).start();
      setHoldPct(0);
    }
  },[isHolding]);

  const onEmgPressIn=useCallback(()=>{
    if(emergencySent)return;
    setIsHolding(true);
    hapticHeavy();
    holdTimeout.current=setTimeout(async()=>{
      setIsHolding(false);
      setEmergencySent(true);
      hapticHeavy();
      await onSendAlert(
        "emergency",
        `🆘 ${account.childName} ACİL YARDIM istedi! Hemen kontrol edin. Saat: ${new Date().toLocaleTimeString("tr-TR")}`,
        account
      );
      // 60 sn sonra tekrar basılabilsin
      setTimeout(()=>setEmergencySent(false),60000);
    },3000);
  },[emergencySent,account,onSendAlert]);

  const onEmgPressOut=useCallback(()=>{
    if(holdTimeout.current){clearTimeout(holdTimeout.current);holdTimeout.current=null;}
    setIsHolding(false);
  },[]);

  // Hızlı duygu bildirimi
  const sendMoodAlert=useCallback(async(level:AlertLevel,label:string)=>{
    await onSendAlert(level,`${account.childName} "${label}" hissediyor ve yardım istiyor. Saat: ${new Date().toLocaleTimeString("tr-TR")}`,account);
    Alert.alert("Gönderildi! 💙","Ebeveynine bildirim iletildi.");
  },[account,onSendAlert]);

  return (
    <SafeAreaView style={{flex:1,backgroundColor:T.bg}}>
      <StatusBar barStyle="dark-content" backgroundColor={T.bg}/>
      <ScrollView contentContainerStyle={$ch.wrap} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={$ch.header}>
          <View>
            <Text style={$ch.hi}>Merhaba 🌟</Text>
            <Text style={$ch.name}>{account.childName}</Text>
          </View>
          <TouchableOpacity onPress={onProfileOpen} activeOpacity={0.85}>
            <LinearGradient colors={[T.amber,T.coral]} style={$ch.ava}>
              <Text style={$ch.avaText}>{initials(account.childName)}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* ══════════════════════════════════════════════════
            ACİL YARDIM BUTONU
        ══════════════════════════════════════════════════ */}
        <View style={$emg.section}>
          <Text style={$emg.sectionTitle}>Yardıma mı ihtiyacın var?</Text>

          {/* Dış glow halkası */}
          <Animated.View style={[$emg.glowRing,{
            transform:[{scale:emgPulse}],
            opacity:emergencySent?0:0.28,
            backgroundColor:emergencySent?T.green:T.red,
          }]}/>

          {/* Dolum halkası (basılı tutarken döner) */}
          {isHolding&&(
            <Animated.View style={[$emg.spinRing,{
              transform:[{rotate:holdAnim.interpolate({inputRange:[0,1],outputRange:["0deg","360deg"]})}]
            }]}/>
          )}

          {/* Ana buton */}
          <Pressable onPressIn={onEmgPressIn} onPressOut={onEmgPressOut} disabled={emergencySent} style={$emg.pressable}>
            <Animated.View style={{transform:[{scale:isHolding?1.04:1}]}}>
              <LinearGradient
                colors={emergencySent?[T.green,"#1B8F58"]:[T.red,T.redDeep]}
                style={$emg.btn}
              >
                <Text style={$emg.btnEmoji}>{emergencySent?"✅":"🆘"}</Text>
                <Text style={$emg.btnLabel}>{emergencySent?"Bildirim Gönderildi!":"ACİL YARDIM"}</Text>
                <Text style={$emg.btnSub}>
                  {emergencySent
                    ?"Ebeveynin haberdar edildi"
                    :isHolding
                      ?`Bırakma… %${holdPct}`
                      :"3 saniye basılı tut"}
                </Text>
              </LinearGradient>
            </Animated.View>
          </Pressable>

          {isHolding&&(
            <View style={$emg.countdownPill}>
              <Text style={{color:T.red,fontWeight:"900",fontSize:13}}>
                ⏱ {Math.ceil(3-(holdPct/100)*3)} saniye kaldı…
              </Text>
            </View>
          )}
        </View>

        {/* Hızlı duygu bildirimleri */}
        <View style={$emg.quickCard}>
          <Text style={$emg.quickTitle}>Durumunu ebeveyninle paylaş</Text>
          <View style={{flexDirection:"row",gap:10}}>
            <TouchableOpacity
              style={[$emg.quickBtn,{backgroundColor:T.skyBg,borderColor:T.sky+"55",flex:1}]}
              activeOpacity={0.8}
              onPress={()=>sendMoodAlert("sad","Çok Üzgünüm")}
            >
              <Text style={{fontSize:22}}>😢</Text>
              <Text style={{fontSize:12,fontWeight:"800",color:T.sky,textAlign:"center"}}>Çok{"\n"}Üzgünüm</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[$emg.quickBtn,{backgroundColor:T.coralBg,borderColor:T.coral+"55",flex:1}]}
              activeOpacity={0.8}
              onPress={()=>sendMoodAlert("anger","Çok Sinirliyim")}
            >
              <Text style={{fontSize:22}}>😤</Text>
              <Text style={{fontSize:12,fontWeight:"800",color:T.coral,textAlign:"center"}}>Çok{"\n"}Sinirliyim</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[$emg.quickBtn,{backgroundColor:T.amberBg,borderColor:T.amber+"55",flex:1}]}
              activeOpacity={0.8}
              onPress={()=>sendMoodAlert("info","Konuşmak İstiyorum")}
            >
              <Text style={{fontSize:22}}>💬</Text>
              <Text style={{fontSize:12,fontWeight:"800",color:T.amber,textAlign:"center"}}>Konuşmak{"\n"}İstiyorum</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Duygu grid */}
        {!result&&!isRec&&!audioUri&&!loading&&(
          <>
            <Text style={$ch.question}>Bugün nasıl hissediyorsun?</Text>
            <View style={$ch.emoGrid}>
              {EMO_ORDER.map(k=>(
                <View key={k} style={[$ch.emoCard,{backgroundColor:EM[k].bg,borderColor:EM[k].border,borderWidth:1.5}]}>
                  <Text style={{fontSize:28}}>{EM[k].emoji}</Text>
                  <Text style={[$ch.emoLabel,{color:EM[k].color}]}>{EM[k].label}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Mikrofon */}
        {!emo&&!loading&&(
          <View style={$ch.micArea}>
            <Animated.View style={{transform:[{scale:pulse}]}}>
              <TouchableOpacity onPress={isRec?onStopRec:onStartRec} activeOpacity={0.85}>
                <LinearGradient colors={isRec?[T.red,T.coral]:[T.amber,T.coral]} style={$ch.micBtn}>
                  <Text style={{fontSize:52}}>{isRec?"⏹":"🎤"}</Text>
                  <Text style={$ch.micLabel}>{isRec?"Durdurmak için dokun":"Konuşmak için dokun"}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
            {isRec&&<Text style={{color:T.red,fontWeight:"700",fontSize:14,marginTop:8}}>🔴 Kaydediyorum…</Text>}
            {audioUri&&!isRec&&(
              <TouchableOpacity style={$ch.analyzeBtn} onPress={onSendAudio}>
                <LinearGradient colors={[T.primary,T.pLight]} style={$ch.analyzeBtnInner}>
                  <Text style={{color:"#fff",fontWeight:"900",fontSize:17}}>✨ Nasıl hissettim?</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        )}

        {loading&&(
          <View style={{alignItems:"center",paddingVertical:32,gap:10}}>
            <Text style={{fontSize:40}}>🔍</Text>
            <Text style={{fontSize:15,fontWeight:"700",color:T.inkMid}}>Duygularını analiz ediyorum…</Text>
          </View>
        )}

        {emo&&!loading&&(
          <LinearGradient colors={emo.grad} style={[$ch.resultCard,{borderColor:emo.border,borderWidth:1.5}]}>
            <Text style={{fontSize:64}}>{emo.emoji}</Text>
            <Text style={[$ch.resultLabel,{color:emo.color}]}>{emo.label}</Text>
            <Text style={{fontSize:15,color:T.inkMid,textAlign:"center",lineHeight:22,fontWeight:"600"}}>{emo.childMsg}</Text>
            <TouchableOpacity style={$ch.retryBtn} onPress={onReset}>
              <Text style={{color:T.inkMid,fontWeight:"700",fontSize:14}}>🔄 Tekrar Konuş</Text>
            </TouchableOpacity>
          </LinearGradient>
        )}

        {result?.error&&!loading&&(
          <View style={{gap:10,marginTop:8}}>
            <View style={{backgroundColor:T.redBg,borderRadius:14,padding:14,borderWidth:1,borderColor:T.red+"44"}}>
              <Text style={{color:T.red,fontWeight:"700",lineHeight:20}}>😕 {result.error}</Text>
            </View>
            {audioUri&&(
              <TouchableOpacity style={$ch.analyzeBtn} onPress={onSendAudio}>
                <LinearGradient colors={[T.amber,T.coral]} style={$ch.analyzeBtnInner}>
                  <Text style={{color:"#fff",fontWeight:"900",fontSize:15}}>🔁 Tekrar Dene</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={{backgroundColor:T.surface,borderRadius:14,paddingVertical:13,alignItems:"center",borderWidth:1,borderColor:T.border}} onPress={onReset}>
              <Text style={{color:T.inkMid,fontWeight:"700",fontSize:14}}>🎤 Yeni Kayıt Yap</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

      {profileOpen&&(
        <>
          <Pressable style={$pd.backdrop} onPress={onProfileClose}/>
          <ChildProfileDropdown account={account} onLogout={()=>{onProfileClose();onLogout();}} onClose={onProfileClose}/>
        </>
      )}
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════

function FormShell({title,subtitle,accent,onBack,children}:{title:string;subtitle:string;accent:string;onBack:()=>void;children:React.ReactNode;}) {
  return (
    <SafeAreaView style={{flex:1,backgroundColor:T.bg}}>
      <StatusBar barStyle="dark-content" backgroundColor={T.bg}/>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":undefined}>
        <ScrollView contentContainerStyle={{padding:24,paddingTop:20,paddingBottom:48}} showsVerticalScrollIndicator={false}>
          <TouchableOpacity style={$fs.back} onPress={onBack}><Text style={$fs.backTxt}>← Geri</Text></TouchableOpacity>
          <View style={[$fs.accent,{backgroundColor:accent}]}/>
          <Text style={$fs.title}>{title}</Text>
          <Text style={$fs.sub}>{subtitle}</Text>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FGroup({label,children}:{label:string;children:React.ReactNode;}) {
  return (
    <View style={{marginBottom:20}}>
      <Text style={{fontSize:11,fontWeight:"800",color:T.inkLight,letterSpacing:1.5,marginBottom:10}}>{label}</Text>
      <View style={{backgroundColor:T.bgCard,borderRadius:18,padding:16,borderWidth:1,borderColor:T.border,gap:14}}>{children}</View>
    </View>
  );
}

function FInput({label,value,onChange,ph,kb,secure,multi,autoCapitalize}:{label:string;value:string;onChange:(v:string)=>void;ph?:string;kb?:any;secure?:boolean;multi?:boolean;autoCapitalize?:any;}) {
  return (
    <View>
      <Text style={{fontSize:12,fontWeight:"700",color:T.inkMid,marginBottom:6}}>{label}</Text>
      <TextInput
        style={{backgroundColor:T.bgCard2,borderRadius:12,paddingHorizontal:14,paddingVertical:12,fontSize:15,color:T.ink,borderWidth:1,borderColor:T.border,...(multi?{height:76,textAlignVertical:"top"}:{})}}
        placeholder={ph} placeholderTextColor={T.inkLight}
        value={value} onChangeText={onChange}
        keyboardType={kb??"default"} secureTextEntry={secure}
        multiline={multi} autoCapitalize={autoCapitalize??"sentences"}
      />
    </View>
  );
}

function ActBtn({label,accent,onPress}:{label:string;accent:string;onPress:()=>void;}) {
  return (
    <TouchableOpacity style={{borderRadius:16,overflow:"hidden",marginTop:8}} activeOpacity={0.85} onPress={onPress}>
      <LinearGradient colors={[accent,accent+"BB"]} start={{x:0,y:0}} end={{x:1,y:0}} style={{paddingVertical:17,alignItems:"center"}}>
        <Text style={{color:"#fff",fontWeight:"900",fontSize:16}}>{label} →</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STYLES
// ═════════════════════════════════════════════════════════════════════════════

const $ob=StyleSheet.create({
  wrap:{flex:1,paddingHorizontal:28,paddingTop:72,paddingBottom:48,justifyContent:"space-between"},
  circle:{position:"absolute",width:220,height:220,borderRadius:110,backgroundColor:"#fff"},
  top:{alignItems:"center",gap:8},
  logoRing:{width:68,height:68,borderRadius:20,backgroundColor:"rgba(255,255,255,0.25)",alignItems:"center",justifyContent:"center"},
  logoStar:{color:"#fff",fontSize:26,fontWeight:"900"},
  appName:{fontSize:22,fontWeight:"900",color:"#fff",letterSpacing:1},
  slide:{flex:1,alignItems:"center",justifyContent:"center",gap:14,paddingVertical:20},
  emojiCard:{width:110,height:110,borderRadius:32,backgroundColor:"rgba(255,255,255,0.25)",alignItems:"center",justifyContent:"center"},
  slideEmoji:{fontSize:52},
  chipWrap:{flexDirection:"row"},
  chip:{backgroundColor:"rgba(255,255,255,0.25)",borderRadius:999,paddingHorizontal:14,paddingVertical:5},
  chipText:{color:"#fff",fontSize:12,fontWeight:"800"},
  slideTitle:{fontSize:28,fontWeight:"900",color:"#fff",textAlign:"center"},
  slideBody:{fontSize:15,color:"rgba(255,255,255,0.85)",textAlign:"center",lineHeight:22},
  bottom:{alignItems:"center",gap:12},
  dots:{flexDirection:"row",gap:8},
  dot:{width:8,height:8,borderRadius:4,backgroundColor:"rgba(255,255,255,0.35)"},
  btn:{backgroundColor:"rgba(255,255,255,0.22)",borderWidth:1.5,borderColor:"rgba(255,255,255,0.5)",borderRadius:18,paddingVertical:16,paddingHorizontal:48},
  btnText:{color:"#fff",fontWeight:"900",fontSize:16},
  skip:{color:"rgba(255,255,255,0.6)",fontSize:14},
});

const $au=StyleSheet.create({
  container:{flexGrow:1,padding:24,paddingTop:16,paddingBottom:48},
  hero:{alignItems:"center",paddingVertical:32,gap:10},
  heroLogo:{width:68,height:68,borderRadius:20,alignItems:"center",justifyContent:"center"},
  heroLogoText:{color:"#fff",fontSize:28,fontWeight:"900"},
  heroTitle:{fontSize:30,fontWeight:"900",color:T.ink},
  heroSub:{fontSize:14,color:T.inkMid,textAlign:"center"},
  heroPills:{flexDirection:"row",gap:8,flexWrap:"wrap",justifyContent:"center",marginTop:4},
  pill:{backgroundColor:T.pBg,borderRadius:999,paddingHorizontal:12,paddingVertical:5},
  pillText:{color:T.primary,fontSize:12,fontWeight:"700"},
  section:{marginBottom:8},
  sectionLabel:{fontSize:11,fontWeight:"800",color:T.inkLight,letterSpacing:1.5,marginBottom:10},
  card:{backgroundColor:T.bgCard,borderRadius:18,padding:16,flexDirection:"row",alignItems:"center",gap:14,borderWidth:1,borderColor:T.border},
  cardIcon:{width:50,height:50,borderRadius:14,alignItems:"center",justifyContent:"center"},
  cardBody:{flex:1},
  cardTitle:{fontSize:16,fontWeight:"800",color:T.ink,marginBottom:2},
  cardSub:{fontSize:13,color:T.inkMid},
  cardChev:{width:32,height:32,borderRadius:999,alignItems:"center",justifyContent:"center"},
});

const $fs=StyleSheet.create({
  back:{backgroundColor:T.surface,paddingHorizontal:14,paddingVertical:9,borderRadius:12,alignSelf:"flex-start",marginBottom:24},
  backTxt:{color:T.inkMid,fontWeight:"700",fontSize:13},
  accent:{width:36,height:4,borderRadius:2,marginBottom:14},
  title:{fontSize:28,fontWeight:"900",color:T.ink,marginBottom:4},
  sub:{fontSize:14,color:T.inkMid,marginBottom:24,lineHeight:20},
});

const $ph=StyleSheet.create({
  bar:{paddingHorizontal:20,paddingTop:12,paddingBottom:12,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  greeting:{fontSize:19,fontWeight:"900",color:T.ink},
  sub:{fontSize:13,color:T.inkMid,marginTop:1},
  ava:{width:40,height:40,borderRadius:999,alignItems:"center",justifyContent:"center"},
  avaText:{color:"#fff",fontWeight:"900",fontSize:14},
  livePill:{backgroundColor:T.redBg,borderRadius:999,paddingHorizontal:10,paddingVertical:5,borderWidth:1,borderColor:T.red},
  livePillTxt:{color:T.red,fontSize:11,fontWeight:"900"},
  tabs:{flexDirection:"row",borderBottomWidth:1,borderBottomColor:T.border,marginHorizontal:20},
  tab:{flex:1,paddingVertical:12,alignItems:"center",borderBottomWidth:2.5,borderBottomColor:"transparent"},
  tabTxt:{fontSize:12,fontWeight:"700",color:T.inkLight},
  badge:{position:"absolute",top:-4,right:-4,backgroundColor:T.red,borderRadius:999,minWidth:18,height:18,alignItems:"center",justifyContent:"center",paddingHorizontal:3,borderWidth:1.5,borderColor:T.bg},
  badgeTxt:{color:"#fff",fontSize:9,fontWeight:"900"},
});

const $pa=StyleSheet.create({
  wrap:{padding:16,gap:14,paddingBottom:48},
  liveCard:{backgroundColor:T.bgCard,borderRadius:18,borderWidth:1,borderColor:T.border,flexDirection:"row",alignItems:"center",gap:14,padding:16},
  liveTitle:{fontSize:15,fontWeight:"800",color:T.ink,marginBottom:2},
  liveSub:{fontSize:12,color:T.inkMid},
  liveBadge:{paddingHorizontal:10,paddingVertical:4,borderRadius:999},
  recCard:{backgroundColor:T.bgCard,borderRadius:18,borderWidth:1,borderColor:T.border,padding:18,gap:14},
  recHeading:{fontSize:15,fontWeight:"800",color:T.ink},
  recRow:{flexDirection:"row",alignItems:"center",gap:16},
  micBtn:{width:64,height:64,borderRadius:999,alignItems:"center",justifyContent:"center"},
  recStatus:{fontSize:16,fontWeight:"800",color:T.ink},
  recDot:{flexDirection:"row",alignItems:"center",gap:6},
  recDotInner:{width:8,height:8,borderRadius:4,backgroundColor:T.red},
  analyzeBtn:{borderRadius:14,paddingVertical:15,alignItems:"center"},
  loadCard:{alignItems:"center",paddingVertical:36,gap:8},
  resultHero:{borderRadius:20,padding:24,alignItems:"center",gap:8},
  resultLabel:{fontSize:28,fontWeight:"900"},
  scoreRow:{backgroundColor:T.bgCard,borderRadius:14,padding:14,gap:8,borderWidth:1,borderColor:T.border},
  trackBg:{height:8,backgroundColor:T.surface,borderRadius:999,overflow:"hidden"},
  trackFill:{height:"100%",borderRadius:999},
  retryBtn:{backgroundColor:T.surface,borderRadius:14,paddingVertical:13,alignItems:"center",borderWidth:1,borderColor:T.border},
});

const $hi=StyleSheet.create({
  wrap:{padding:16,gap:14,paddingBottom:48},
  sumCard:{borderRadius:20,padding:20,gap:10},
  sumTitle:{fontSize:19,fontWeight:"900",color:"#fff"},
  sumSub:{fontSize:12,color:"rgba(255,255,255,0.75)",marginBottom:2},
  sumRow:{flexDirection:"row",alignItems:"center",gap:10},
  sumTrack:{flex:1,height:8,backgroundColor:"rgba(255,255,255,0.25)",borderRadius:999,overflow:"hidden"},
  sumFill:{height:"100%",borderRadius:999},
  sumCnt:{width:22,textAlign:"right",color:"#fff",fontWeight:"900",fontSize:13},
  listHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  listTitle:{fontSize:16,fontWeight:"900",color:T.ink},
  empty:{alignItems:"center",paddingVertical:40,gap:8},
  card:{backgroundColor:T.bgCard,borderRadius:16,padding:14,gap:4,borderWidth:1,borderColor:T.border},
  cardTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:6},
  badge:{flexDirection:"row",alignItems:"center",gap:6,paddingHorizontal:10,paddingVertical:5,borderRadius:999},
  badgeLabel:{fontWeight:"800",fontSize:12},
});

const $ch=StyleSheet.create({
  wrap:{flexGrow:1,padding:20,paddingBottom:48,gap:20},
  header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  hi:{fontSize:14,color:T.inkMid,fontWeight:"600"},
  name:{fontSize:26,fontWeight:"900",color:T.ink},
  ava:{width:44,height:44,borderRadius:999,alignItems:"center",justifyContent:"center"},
  avaText:{color:"#fff",fontWeight:"900",fontSize:16},
  question:{fontSize:18,fontWeight:"800",color:T.ink,textAlign:"center"},
  emoGrid:{flexDirection:"row",flexWrap:"wrap",gap:12,justifyContent:"center"},
  emoCard:{width:"45%",borderRadius:18,padding:16,alignItems:"center",gap:8},
  emoLabel:{fontSize:13,fontWeight:"800"},
  micArea:{alignItems:"center",gap:14},
  micBtn:{width:180,height:180,borderRadius:999,alignItems:"center",justifyContent:"center",shadowColor:T.amber,shadowOffset:{width:0,height:8},shadowOpacity:0.3,shadowRadius:20,elevation:10},
  micLabel:{color:"#fff",fontWeight:"800",fontSize:13,textAlign:"center",paddingHorizontal:14},
  analyzeBtn:{borderRadius:18,overflow:"hidden",width:"100%"},
  analyzeBtnInner:{paddingVertical:16,alignItems:"center"},
  resultCard:{borderRadius:24,padding:28,alignItems:"center",gap:10},
  resultLabel:{fontSize:28,fontWeight:"900"},
  retryBtn:{backgroundColor:T.surface,borderRadius:14,paddingVertical:11,paddingHorizontal:22,marginTop:4},
});

// ── Acil buton stilleri ───────────────────────────────────────────────────────
const $emg=StyleSheet.create({
  section:{alignItems:"center",backgroundColor:T.bgCard,borderRadius:24,padding:20,borderWidth:1,borderColor:T.border,gap:14,
    shadowColor:T.red,shadowOffset:{width:0,height:4},shadowOpacity:0.08,shadowRadius:16,elevation:4},
  sectionTitle:{fontSize:14,fontWeight:"800",color:T.inkMid,letterSpacing:0.3},
  glowRing:{position:"absolute",width:196,height:196,borderRadius:98,
    shadowColor:T.red,shadowOffset:{width:0,height:0},shadowOpacity:1,shadowRadius:32,elevation:16},
  spinRing:{position:"absolute",width:168,height:168,borderRadius:84,
    borderWidth:5,borderColor:"transparent",borderTopColor:T.redDeep,top:(196-168)/2+20+28},
  pressable:{},
  btn:{width:156,height:156,borderRadius:78,alignItems:"center",justifyContent:"center",gap:4,
    shadowColor:T.red,shadowOffset:{width:0,height:6},shadowOpacity:0.45,shadowRadius:18,elevation:12},
  btnEmoji:{fontSize:38},
  btnLabel:{color:"#fff",fontWeight:"900",fontSize:15,letterSpacing:0.4},
  btnSub:{color:"rgba(255,255,255,0.78)",fontSize:11,fontWeight:"600",textAlign:"center",paddingHorizontal:12},
  countdownPill:{backgroundColor:T.redBg,borderRadius:999,paddingHorizontal:16,paddingVertical:7,borderWidth:1,borderColor:T.red+"44"},
  quickCard:{backgroundColor:T.bgCard,borderRadius:20,padding:16,borderWidth:1,borderColor:T.border,gap:12},
  quickTitle:{fontSize:13,fontWeight:"800",color:T.inkMid},
  quickBtn:{alignItems:"center",justifyContent:"center",borderRadius:14,paddingVertical:12,paddingHorizontal:8,gap:6,borderWidth:1},
});

// ── Alert card stilleri ───────────────────────────────────────────────────────
const $alc=StyleSheet.create({
  card:{backgroundColor:T.bgCard,borderRadius:14,padding:14,borderWidth:1,borderColor:T.border,gap:10},
  row:{flexDirection:"row",gap:12,alignItems:"flex-start"},
  icon:{width:40,height:40,borderRadius:12,alignItems:"center",justifyContent:"center"},
  level:{fontSize:12,fontWeight:"900",letterSpacing:0.5},
  msg:{fontSize:13,color:T.ink,lineHeight:19},
  time:{fontSize:11,color:T.inkLight,fontWeight:"600"},
  actions:{flexDirection:"row",gap:8,justifyContent:"flex-end"},
  actionBtn:{borderRadius:10,paddingHorizontal:12,paddingVertical:7},
  drawer:{
    position:"absolute",top:Platform.OS==="ios"?100:72,right:16,
    width:320,backgroundColor:T.bgCard,borderRadius:20,
    shadowColor:"#000",shadowOffset:{width:0,height:8},shadowOpacity:0.18,shadowRadius:24,elevation:16,
    borderWidth:1,borderColor:T.border,overflow:"hidden",zIndex:999,
  },
  drawerHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",padding:16,borderBottomWidth:1,borderBottomColor:T.border},
});

const $pd=StyleSheet.create({
  backdrop:{position:"absolute",top:0,left:0,right:0,bottom:0,backgroundColor:"rgba(0,0,0,0.25)"},
  dropdown:{
    position:"absolute",top:Platform.OS==="ios"?100:72,right:16,width:320,
    backgroundColor:T.bgCard,borderRadius:20,
    shadowColor:"#000",shadowOffset:{width:0,height:8},shadowOpacity:0.18,shadowRadius:24,elevation:16,
    borderWidth:1,borderColor:T.border,overflow:"hidden",zIndex:999,
  },
  arrow:{position:"absolute",top:-8,right:20,width:16,height:16,backgroundColor:T.bgCard,transform:[{rotate:"45deg"}],borderTopWidth:1,borderLeftWidth:1,borderColor:T.border},
  header:{flexDirection:"row",alignItems:"center",gap:12,padding:16,paddingBottom:12,borderBottomWidth:1,borderBottomColor:T.border},
  ava:{width:44,height:44,borderRadius:999,alignItems:"center",justifyContent:"center"},
  avaText:{color:"#fff",fontWeight:"900",fontSize:16},
  name:{fontSize:15,fontWeight:"900",color:T.ink},
  email:{fontSize:12,color:T.inkMid},
  closeBtn:{width:30,height:30,borderRadius:999,backgroundColor:T.surface,alignItems:"center",justifyContent:"center"},
  tabs:{flexDirection:"row",borderBottomWidth:1,borderBottomColor:T.border},
  tabBtn:{flex:1,paddingVertical:11,alignItems:"center",borderBottomWidth:2,borderBottomColor:"transparent"},
  tabTxt:{fontSize:11,fontWeight:"700",color:T.inkLight},
  saveBtn:{borderRadius:12,paddingVertical:14,alignItems:"center",marginTop:4},
  saveBtnTxt:{color:"#fff",fontWeight:"900",fontSize:14},
  linkedCard:{backgroundColor:T.surface,borderRadius:16,padding:18,alignItems:"center",gap:6},
  idBox:{backgroundColor:T.pBg,borderRadius:12,padding:14,alignItems:"center"},
  idLabel:{fontSize:11,color:T.inkLight,fontWeight:"700",letterSpacing:0.5,marginBottom:4,textAlign:"center"},
  idValue:{fontSize:16,fontWeight:"900",color:T.primary,letterSpacing:3},
  logoutBtn:{backgroundColor:T.redBg,borderRadius:14,paddingVertical:13,alignItems:"center",borderWidth:1,borderColor:T.red+"33"},
});
