# Stage 1: Build
FROM node:20-slim AS build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production
FROM gcr.io/distroless/nodejs20-debian12
WORKDIR /usr/src/app
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/package.json ./
CMD ["dist/index.js"]