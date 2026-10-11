FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /server \
    ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot

# どの PR・コミットのビルドかを /status と /health に出すため、CI（api-build.yml）が渡す。
# 渡さなければ空（ローカル、api-ci の image job、旧サービスの Cloud Build）。
#
# -ldflags で焼かずに最後のステージの ENV にしているのは、builder のキャッシュを
# 効かせるため。コミットはフロントだけの push でも変わるので、go build に渡すと
# そのたびに API をビルドし直すことになる。
ARG BUILD_PR=""
ARG BUILD_COMMIT=""
ENV BUILD_PR=${BUILD_PR} \
    BUILD_COMMIT=${BUILD_COMMIT}

WORKDIR /

COPY --from=builder /server /server

USER nonroot:nonroot

EXPOSE 8080

ENTRYPOINT ["/server"]
