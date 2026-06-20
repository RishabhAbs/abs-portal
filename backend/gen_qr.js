const QRCode = require('qrcode');
const speakeasy = require('speakeasy');
const fs = require('fs');

const s = speakeasy.generateSecret({ length: 20, name: 'ABS Cloud', issuer: 'ABS' });
const secret = s.base32;
const otpauth = s.otpauth_url;

QRCode.toDataURL(otpauth, { width: 300 }, (err, url) => {
  const html = `<!DOCTYPE html>
<html><body style="text-align:center;padding:40px;font-family:sans-serif">
<h2>Scan with Google Authenticator</h2>
<img src="${url}" style="width:300px;height:300px"/>
<p>Secret: <b>${secret}</b></p>
</body></html>`;
  fs.writeFileSync('C:/Users/hp/Desktop/scan_2fa.html', html);
  fs.writeFileSync('C:/Users/hp/Desktop/abs_secret.txt', secret);
  console.log('SECRET:', secret);
  const token = speakeasy.totp({ secret, encoding: 'base32' });
  console.log('Current code:', token);
});
