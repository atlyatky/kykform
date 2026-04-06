FROM node:22-alpine AS build
WORKDIR /app
# Boş = tarayıcı aynı origin üzerinden /api çağırır (VPS / docker içi nginx proxy)
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
# Yönetim panelinden kopyalanan form linki için dış adres (örn. https://form.sirket.com). Boş = otomatik.
ARG VITE_PUBLIC_FORM_BASE_URL=
ENV VITE_PUBLIC_FORM_BASE_URL=$VITE_PUBLIC_FORM_BASE_URL
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
ARG NGINX_CONFIG=nginx.conf
COPY ${NGINX_CONFIG} /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
