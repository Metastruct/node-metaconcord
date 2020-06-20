# node-metaconcord

## Setup

Strip the file names of `*.config.example.json` from the `.example` bits, and configure all the fields as you wish.

I trust you can figure where to get all the tokens, API keys and IDs?

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
