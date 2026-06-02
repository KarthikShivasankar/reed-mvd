# --- build stage: Vite production build (fast; seconds, not minutes) ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# --- serve stage: static files via nginx ---
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Runtime endpoint config (override by bind-mounting over this path).
COPY public/config.json /usr/share/nginx/html/config.json
EXPOSE 8080
