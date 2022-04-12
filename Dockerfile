FROM python:3.10
WORKDIR /app
COPY . /app
RUN pip install poetry && \
    poetry install
EXPOSE 8000
CMD poetry run uvicorn --host 0.0.0.0 pn.app:app
