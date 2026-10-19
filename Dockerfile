FROM node:22-alpine
RUN apk add --no-cache android-tools
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
# Port ADB dédié : évite de partager le serveur adb d'un autre conteneur en réseau "host"
ENV PORT=8420 DATA_DIR=/data HOME=/data ANDROID_ADB_SERVER_PORT=5038
VOLUME /data
EXPOSE 8420
USER node
CMD ["node", "server/index.js"]
