FROM node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY config.example.yaml ./

ENV OESF_LPR_AGENT_CONFIG=/app/data/config.yaml
ENV OESF_LPR_AGENT_PORT=8787
EXPOSE 8787

CMD ["node", "src/index.js"]
