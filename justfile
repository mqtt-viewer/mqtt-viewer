test PATH='./...':
  set -o pipefail && go test {{PATH}} fmt -json | tparse -all

new-migration NAME:
  atlas migrate diff --env gorm {{NAME}}

build VERSION="v0.0.1-defaultv":
  wails build -ldflags "-X mqtt-viewer/backend/env.Version={{VERSION}}"

build-pi VERSION="v0.0.1-defaultv":
  ~/go/bin/wails build -ldflags "-X mqtt-viewer/backend/env.Version={{VERSION}}"