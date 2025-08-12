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

#hack, remove config after building so we can mount it
#todo: handle empty config in the app
RUN rm -rf ./config

EXPOSE 20122

CMD [ "yarn", "start" ]