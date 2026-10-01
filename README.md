# EmotiVoice: Çocuklar İçin Ses Tabanlı Duygu Tanıma Sistemi

EmotiVoice, çocukların günlük konuşma seslerinden duygu durumlarını otomatik olarak tespit eden, ebeveynler ve bakım verenler için geliştirilmiş mobil tabanlı bir yapay zeka projesidir. Çocukların duygularını her zaman kelimelerle ifade edememesi ve fark edilmeyen duygusal sıkıntıların gelişimlerini olumsuz etkileyebilmesi temel alınarak tasarlanmıştır.

<img src="./poster.png" alt="Tez Posteri" width="100%">

## 🚀 Proje Hakkında
Konuşma, zengin duygusal bilgiler barındırır. EmotiVoice; çocukların yabancı olmadıkları doğal ses etkileşimleri üzerinden pasif bir şekilde duygu analizi yaparak erken müdahaleye olanak tanır. 

Sistem dört temel duyguyu sınıflandırmaktadır:
* Mutlu (Happy)
* Nötr (Neutral)
* Üzgün (Sadness)
* Kızgın (Anger)

## 🛠️ Sistem Mimarisi ve Teknolojiler
Proje, bir mobil arayüz ile Python tabanlı bir yapay zeka sunucusundan oluşur:
* **Mobil Uygulama:** React Native ile geliştirilmiş ebeveyn ve çocuk arayüzleri.
* **Backend:** FastAPI ve Uvicorn kullanılarak oluşturulan, ses işleme ve tahmin yapan sunucu.
* **Yapay Zeka Modeli:** Microsoft WavLM (base-plus) tabanlı transfer öğrenme yaklaşımı. Büyük ölçekli ses verileriyle önceden eğitilmiş WavLM kodlayıcısı (encoder) dondurulmuş (frozen), üzerine eklenen sınıflandırma katmanı hedef veri setiyle eğitilmiştir.
* **Veri Setleri:** Modelin eğitiminde temel olarak iki dilli çocuk seslerini içeren **C-BESD** veri seti (~2.5 saat) kullanılmış, eksik duygu sınıflarını desteklemek amacıyla **SER Voice Dataset** ile artırma (augmentation) yapılmıştır.

## 📱 Kullanım Akışı
1. Kullanıcı mobil cihaz üzerinden ses kaydı gerçekleştirir.
2. Kayıt, `/predict` endpoint'ine `POST` isteği ile FastAPI backend'ine gönderilir.
3. Ses verisi `librosa` ile 16 kHz'e yeniden örneklenir.
4. Dondurulmuş WavLM kodlayıcısından geçirilerek özellik çıkarımı yapılır ve tahmin edilen duygu etiketi, güven skoru ile birlikte uygulamaya JSON formatında geri döndürülür.

## 👥 Geliştiriciler
* Buse Berfin Halefoğlu
* Nazlı Tokgöz


**Danışman:** Asst. Prof. Çağdaş Eşiyok