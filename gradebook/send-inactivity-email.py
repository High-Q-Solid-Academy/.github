import json
import os
import smtplib
import ssl
from email.headerregistry import Address
from email.message import EmailMessage
from pathlib import Path


def env(name):
    return os.environ.get(name, '').strip()


queue_path = Path(env('INACTIVITY_EMAIL_QUEUE') or 'inactivity-email-queue.json')
if not queue_path.exists():
    print('No inactivity email queue found; nothing to send.')
    raise SystemExit(0)

queue = json.loads(queue_path.read_text(encoding='utf-8'))
if not queue:
    print('No direct inactivity emails queued.')
    raise SystemExit(0)

username = env('REPORT_SMTP_USERNAME')
password = env('REPORT_SMTP_PASSWORD')
if not username or not password:
    raise RuntimeError('REPORT_SMTP_USERNAME and REPORT_SMTP_PASSWORD are required when inactivity emails are queued.')

host = env('REPORT_SMTP_HOST') or 'smtp.gmail.com'
port = int(env('REPORT_SMTP_PORT') or '465')
security = (env('REPORT_SMTP_SECURITY') or ('ssl' if port == 465 else 'starttls')).lower()
sender = env('REPORT_EMAIL_FROM') or username
sender_name = env('REPORT_EMAIL_FROM_NAME') or 'High Q Solid Academy'
context = ssl.create_default_context()


def build_message(item):
    state = item.get('state')
    real_name = item.get('realName') or item.get('learner')
    course = item.get('course') or 'your current course'
    inactive_days = item.get('inactiveDays')
    last_activity = item.get('lastActivity') or 'Unknown'
    issue_url = item.get('issueUrl')

    if state == 'warning':
        subject = 'High Q course inactivity warning — 1 day remaining'
        intro = f'Hi {real_name},\n\nYour High Q course "{course}" has been inactive for {inactive_days} full days.'
        action = 'You have 1 day to resume learner activity. Push a course commit, update/open a pull request, or participate in a course issue.'
        ending = 'If there is still no learner activity after the grace period, the course will move to manual instructor review. Nothing is deleted automatically.'
    else:
        subject = 'High Q course — instructor review pending'
        intro = f'Hi {real_name},\n\nYour 1-day grace period has ended and your unfinished High Q course "{course}" is now pending instructor review.'
        action = 'No repository has been deleted. You can still resume learner activity before an instructor approves disenrollment.'
        ending = 'If an instructor approves disenrollment, your current unfinished course repository will be removed after your progress is preserved.'

    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = Address(display_name=sender_name, addr_spec=sender)
    message['To'] = item['email']
    message['Reply-To'] = Address(display_name=sender_name, addr_spec=sender)

    text = f'{intro}\n\n{action}\n\n{ending}\n\nLast learner activity: {last_activity}'
    if issue_url:
        text += f'\nCourse notice: {issue_url}'
    text += '\n\nHigh Q Solid Academy'
    message.set_content(text)

    issue_html = f'<p><a href="{issue_url}">Open course notice</a></p>' if issue_url else ''
    message.add_alternative(
        f'<p>Hi {real_name},</p>'
        f'<p>{intro.split(chr(10))[-1]}</p>'
        f'<p>{action}</p>'
        f'<p>{ending}</p>'
        f'<p><strong>Last learner activity:</strong> {last_activity}</p>'
        f'{issue_html}'
        f'<p>High Q Solid Academy</p>',
        subtype='html',
    )
    return message


def send_all(smtp):
    for item in queue:
        smtp.send_message(build_message(item))
        print(f"Sent {item.get('state')} inactivity email to @{item.get('learner')} ({item.get('email')}).")


if security in ('tls', 'starttls'):
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls(context=context)
        smtp.ehlo()
        smtp.login(username, password)
        send_all(smtp)
elif security in ('ssl', 'smtps'):
    with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as smtp:
        smtp.login(username, password)
        send_all(smtp)
else:
    raise ValueError('REPORT_SMTP_SECURITY must be starttls/tls or ssl/smtps.')

print(f'Sent {len(queue)} direct learner inactivity email(s).')
