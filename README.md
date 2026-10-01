![Tez Posteri](./poster.png)
# EmotiVoice: Çocuklar İçin Ses Tabanlı Duygu Tanıma Sistemi

EmotiVoice, çocukların günlük konuşma seslerinden duygu durumlarını otomatik olarak tespit eden, ebeveynler ve bakım verenler için geliştirilmiş mobil tabanlı bir yapay zeka projesidir[cite: 1]. Çocukların duygularını her zaman kelimelerle ifade edememesi ve fark edilmeyen duygusal sıkıntıların gelişimlerini olumsuz etkileyebilmesi temel alınarak tasarlanmıştır[cite: 1].

##  Proje Hakkında
Konuşma, zengin duygusal bilgiler barındırır[cite: 1]. EmotiVoice; çocukların yabancı olmadıkları doğal ses etkileşimleri üzerinden pasif bir şekilde duygu analizi yaparak erken müdahaleye olanak tanır[cite: 1]. 

Sistem dört temel duyguyu sınıflandırmaktadır:
* Mutlu (Happy)[cite: 1]
* Nötr (Neutral)[cite: 1]
* Üzgün (Sadness)[cite: 1]
* Kızgın (Anger)[cite: 1]

##  Sistem Mimarisi ve Teknolojiler
Proje, bir mobil arayüz ile Python tabanlı bir yapay zeka sunucusundan oluşur[cite: 1]:
* **Mobil Uygulama:** React Native ile geliştirilmiş ebeveyn ve çocuk arayüzleri[cite: 1].
* **Backend:** FastAPI ve Uvicorn kullanılarak oluşturulan, ses işleme ve tahmin yapan sunucu[cite: 1].
* **Yapay Zeka Modeli:** Microsoft WavLM (base-plus) tabanlı transfer öğrenme yaklaşımı. Büyük ölçekli ses verileriyle önceden eğitilmiş WavLM kodlayıcısı (encoder) dondurulmuş (frozen), üzerine eklenen sınıflandırma katmanı hedef veri setiyle eğitilmiştir[cite: 1].
* **Veri Setleri:** Modelin eğitiminde temel olarak iki dilli çocuk seslerini içeren **C-BESD** veri seti (~2.5 saat) kullanılmış, eksik duygu sınıflarını desteklemek amacıyla **SER Voice Dataset** ile artırma (augmentation) yapılmıştır[cite: 1].

##  Kullanım Akışı
1. Kullanıcı mobil cihaz üzerinden ses kaydı gerçekleştirir[cite: 1].
2. Kayıt, `/predict` endpoint'ine `POST` isteği ile FastAPI backend'ine gönderilir[cite: 1].
3. Ses verisi `librosa` ile 16 kHz'e yeniden örneklenir[cite: 1].
4. Dondurulmuş WavLM kodlayıcısından geçirilerek özellik çıkarımı yapılır ve tahmin edilen duygu etiketi, güven skoru ile birlikte uygulamaya JSON formatında geri döndürülür[cite: 1].

##  Geliştiriciler
* Buse Berfin Halefoğlu[cite: 1]
* Nazlı Tokgöz[cite: 1]


**Danışman:** Asst. Prof. Çağdaş Eşiyok[cite: 1]