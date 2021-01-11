# node-metaconcord

## [Objective](https://hackmd.io/SwE_rpqESKSfV0LMvBd0Kw?both)

## Setup

Strip the file names of `*.example.json` from the `.example` bits, and configure all the fields as you wish.

Although, I doubt this can be useful for anyone other than Meta Construct as-is. It will probably work with some tuning but you're better off forking the project to make your own changes and additions.

Of course, you'll need the [gmod-metaconcord](https://github.com/Metastruct/gmod-metaconcord) add-on installed on your server to allow for communication with this service.

### Production

```bash
# Install dependencies
$ yarn

# WSL or Linux
$ ./schema_gen.sh

# Go wacky
$ yarn build
$ yarn start
```

### Development

```bash
# Install dependencies
$ yarn

# WSL or Linux
$ ./schema_gen.sh

# Go wacky
$ yarn dev
```
