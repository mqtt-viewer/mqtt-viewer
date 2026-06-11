test PATH='./...':
  set -o pipefail && go test {{PATH}} fmt -json | tparse -all

new-migration NAME:
  atlas migrate diff --env gorm {{NAME}}

build VERSION="v0.0.1-defaultv":
  wails3 task package VERSION={{VERSION}} LD_FLAGS="-X mqtt-viewer/backend/env.Version={{VERSION}}"

dev:
  wails3 dev