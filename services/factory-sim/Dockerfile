FROM python:3.12-alpine
RUN pip install --no-cache-dir paho-mqtt==2.1.0
WORKDIR /app
COPY sim.py /app/sim.py
# named volume for the last published time (empty volumes inherit this owner)
RUN mkdir /state && chown nobody /state
RUN python /app/sim.py --self-check
USER nobody
ENTRYPOINT ["python", "-u", "/app/sim.py"]
