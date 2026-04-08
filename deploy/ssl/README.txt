HTTPS için bu klasöre iki dosya koyun (docker-compose.https.yml kullanırken):

  fullchain.pem   — sertifika + ara CA (Let's Encrypt: fullchain.pem)
  privkey.pem     — özel anahtar

Geçici self-signed (sadece test; tarayıcı uyarı verir):

  openssl req -x509 -nodes -days 365 -newkey rsa:2048 ^
    -keyout privkey.pem -out fullchain.pem -subj "/CN=localhost"

Üretimde Let's Encrypt (certbot) veya kurumsal CA kullanın.
