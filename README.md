# Magic Picker

5–6 yaş sınıfları için öğrenci seçme + yıldızla kart kazanma uygulaması. Sunucusuz çalışır; veriler tarayıcıda (IndexedDB) saklanır.

## Açma

- **En kolayı:** `index.html` dosyasına çift tıklayın (Chrome veya Edge önerilir). İnternet gerekmez; internet varsa başlık yazı tipleri de yüklenir.
- **Alternatif (Mac):** klasörde `ruby -run -e httpd . -p 8765` çalıştırıp `http://localhost:8765` adresini açın.
- Gizli/özel pencerede kullanmayın: pencere kapanınca veriler silinir.

## Akış

Class → öğrenci adı veya **Pick a Student** → öğretmen yıldız verir → **Choose a Card** → **My Collection**

- Öğretmen araçları: sağ üstteki **Teacher**. Panel açıkken öğrenci ekranlarında `+1 +2 +3 / Other` yıldız düğmeleri görünür; **Lock** ile gizlenir.
- İlk iş: Teacher → Öğrenciler → isimleri tek tek ya da toplu (her satıra bir isim) ekleyin. Denemek için Yedek ve Veri → **Demo verisi yükle** (ayrı “DEMO” sınıfı, tek tıkla silinir).

## Kurallar

- Varsayılan 5 yıldız = 1 kart (Ayarlar’dan değişir; geçmiş yeniden hesaplanmaz).
- “Toplam kazanılan” ve “harcanabilir bakiye” ayrı tutulur; bakiye eksiye düşmez.
- Kart alma tek veritabanı işlemidir: yıldız düşümü + kartın albüme eklenmesi birlikte olur ya da hiçbiri olmaz. Aynı onay iki kez uygulanamaz.
- Tüm kartlar eşit değerdedir; Surprise Me, sahip olunmayan kartlar arasından eşit olasılıkla seçer.
- “Son işlemi geri al” seçili sınıftaki son yıldız/kart işlemini geri alır (kart → albümden çıkar, yıldız geri gelir).

## Yazdırma

Öğrenci Detay → Yazdır: **Dolu albüm**, **Boş albüm**, **Kazanılan kart sayfaları**; ayrıca “Tüm 40 kart” ve Sınıflar sekmesinden tüm sınıf.
Albüm (kapak + 10 albüm sayfası + arka kapak = 12 sayfa) için iki düzen var; yazdırma ekranındaki **Düzen** düğmesinden seçilir:

| Düzen | Kâğıt | Yazdırma ayarı | Sonuç |
|---|---|---|---|
| **Ayrı A5 sayfalar** (varsayılan) | A5 | A5, %100 | 12 ayrı A5 yaprak |
| **A4 katlamalı kitapçık** | A4 | A4 yatay, %100, kenar boşluğu yok, çift taraflı **kısa kenardan çevir** | 3 A4 yaprak (6 yüz); üst üste koyup ortadan katlayın, sırttan zımbalayın |

Her iki düzende de A5 sayfa ölçüsü ve kart yuvaları aynıdır. Kitapçıkta sayfa sırası otomatik dizilir (1. yaprak: 12|1 ve 2|11 …).
Her zaman “Arka plan grafikleri” açık olsun. PDF için “PDF olarak kaydet”.
Kart baskı sayfaları her zaman A5’tir; kartlar albüm yuvasıyla aynı ölçüdedir: 57 × 47,5 mm.

## Veri ve güvenlik

- Veriler yalnızca bu cihazdaki bu tarayıcıda durur; cihazlar arasında **eşitlenmez**, bulut yedeği yoktur. Düzenli olarak Yedek ve Veri → **Yedeği indir (JSON)**.
- Geri yükleme önce dosyayı doğrular; bozuk dosya mevcut veriyi değiştirmez.
- PIN yalnızca öğretmen araçlarını bu ekranda gizler; **gerçek kimlik doğrulama değildir**, veriyi şifrelemez.

## Dosyalar

- `index.html`, `css/`, `js/` – uygulama (`js/store.js` veri katmanı)
- `assets/cards/adv-01…20.jpg` (Adventure, 1. görsel) ve `won-01…20.jpg` (Wonder, 4. görsel) – 264×220 px kırpılmış kartlar
- `assets/card-back.jpg` (2. görselin sağ üstü), `assets/stage.jpg` (3. görsel), `assets/source/` – orijinaller
- `tools/crop-cards.sh` – kartları orijinallerden yeniden kesen komut (macOS `sips`)
- `tests.html` – veri katmanı senaryo testleri (ayrı test veritabanı kullanır, gerçek veriye dokunmaz)
