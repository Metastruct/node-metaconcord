FROM zenika/alpine-chrome:with-puppeteer

USER root
RUN set -eux \
  & apk add \
  --no-cache \
  yarn \
  bash 

WORKDIR /app

COPY package.json .
COPY yarn.lock .
RUN yarn install
COPY . .
RUN cd ./config && \
  for f in *.example.json; do \
  cp "$f" "${f/.example.json/.json}"; \
  done
  
#todo: remove/replace schema_gen.sh it is so slow..
RUN ./schema_gen.sh
RUN yarn build

#hack, remove config after building so we can mount it
#todo: handle empty config in the app
RUN rm -rf ./config

EXPOSE 20122
ENTRYPOINT ["tini", "--"]
CMD [ "yarn", "start" ]