FROM nginx:alpine

COPY view/nginx.conf /etc/nginx/conf.d/default.conf
COPY view/ /usr/share/nginx/html/
RUN mkdir -p /usr/share/nginx/html/download
COPY view/download/network-scanner.exe /usr/share/nginx/html/download/network-scanner.exe
