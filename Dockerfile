FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY dist ./dist
COPY package.json ./

EXPOSE 3000
CMD ["node", "dist/boot.js"]
