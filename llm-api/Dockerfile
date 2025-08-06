FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache chromium ttf-freefont chromium-chromedriver 

COPY ./package.json ./

RUN npm install

RUN npm install nodemon

EXPOSE 3000

CMD ["npx", "nodemon", "app.js"]
