FROM node:24-alpine

RUN corepack enable

WORKDIR /usr/src/app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules ./modules
COPY services/pos ./services/pos

RUN pnpm install --frozen-lockfile

WORKDIR /usr/src/app/services/pos
RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "preview", "--host", "0.0.0.0", "--port", "3000"]
