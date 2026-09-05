FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir flask>=3.0.0 requests>=2.31.0 psycopg2-binary>=2.9.0
COPY . ./
EXPOSE 8000
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8000","--reload"]