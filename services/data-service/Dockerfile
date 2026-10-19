FROM python:3.12-alpine
WORKDIR /app
COPY server.py /app/server.py
EXPOSE 8090
HEALTHCHECK --interval=5s --retries=30 CMD python -c "import os,ssl,urllib.request as u; s='https' if os.environ.get('TLS_CERT') else 'http'; u.urlopen(f'{s}://127.0.0.1:8090/health', context=ssl._create_unverified_context() if s=='https' else None)" || exit 1
USER nobody
ENTRYPOINT ["python", "-u", "/app/server.py"]
