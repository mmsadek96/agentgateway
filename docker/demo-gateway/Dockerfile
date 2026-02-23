FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY index.ts ./

EXPOSE 3001

CMD ["npx", "ts-node", "index.ts"]
