FROM node:22

WORKDIR /app

COPY package.json .
COPY yarn.lock .
RUN yarn install
COPY . .

RUN yarn build
RUN ./schema_gen.sh

EXPOSE 20122

CMD [ "yarn", "start" ]