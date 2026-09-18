import os
import smtplib
import ssl
from email.message import EmailMessage
from pathlib import Path


def required(name):
    return os.environ.get(name, '').strip()


username = required('REPORT_SMTP_USERNAME')
password = required('REPORT_SMTP_PASSWORD')
recipients = [item.strip() for item in required('REPORT_EMAIL_RECIPIENTS').replace(';', ',').split(',') if item.strip()]

if not username or not password or not recipients:
    print('Email delivery skipped: REPORT_SMTP_USERNAME, REPORT_SMTP_PASSWORD, or REPORT_EMAIL_RECIPIENTS is not configured.')
    raise SystemExit(0)

host = required('REPORT_SMTP_HOST') or 'smtp.gmail.com'
port = int(required('REPORT_SMTP_PORT') or '465')
security = (required('REPORT_SMTP_SECURITY') or ('ssl' if port == 465 else 'starttls')).lower()
sender = required('REPORT_EMAIL_FROM') or username
root = Path(__file__).resolve().parent.parent

message = EmailMessage()
message['Subject'] = 'High Q Solid Academy — Instructor Gradebook'
message['From'] = sender
message['To'] = ', '.join(recipients)
message.set_content('The current High Q instructor gradebook is attached in print-ready HTML, CSV, and JSON formats. Open the HTML file in a browser and print it for paper records or save it as PDF.')
message.add_alternative('<h2>High Q Solid Academy</h2><p>The current instructor gradebook is attached in <strong>print-ready HTML</strong>, CSV, and JSON formats.</p><p>Open <code>gradebook.html</code> in a browser and print it for paper records or save it as PDF.</p>', subtype='html')

attachments = [
    ('gradebook.html', 'text', 'html'),
    ('gradebook.csv', 'text', 'csv'),
    ('gradebook.json', 'application', 'json'),
]
for filename, maintype, subtype in attachments:
    path = root / filename
    message.add_attachment(path.read_bytes(), maintype=maintype, subtype=subtype, filename=filename)

context = ssl.create_default_context()
if security in ('tls', 'starttls'):
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls(context=context)
        smtp.ehlo()
        smtp.login(username, password)
        smtp.send_message(message)
elif security in ('ssl', 'smtps'):
    with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as smtp:
        smtp.login(username, password)
        smtp.send_message(message)
else:
    raise ValueError('REPORT_SMTP_SECURITY must be starttls/tls or ssl/smtps.')

print(f'Gradebook email sent to {len(recipients)} configured recipient(s).')
