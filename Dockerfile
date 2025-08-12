FROM node:22

WORKDIR /app

COPY package.json .
COPY yarn.lock .
RUN yarn install
COPY . .
RUN for f in ./config/*.example.json; do \
    cp "$f" "./config/$(basename "$f" .example.json).json"; \
    done

RUN ./schema_gen.sh
RUN yarn build

EXPOSE 20122

CMD [ "yarn", "start" ]