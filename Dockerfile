FROM node:24

# install chrome for puppeteer (how annoying)
RUN apt-get update \
  && apt-get install -y wget gnupg \
  && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
  && apt-get update \
  && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

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