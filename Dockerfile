FROM golang:1.24-alpine AS builder
WORKDIR /app/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /pi-remote-server ./cmd/pi-remote-server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /pi-remote-server /pi-remote-server
EXPOSE 8787
ENTRYPOINT ["/pi-remote-server"]
