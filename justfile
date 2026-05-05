test PATH='./...':
  set -o pipefail && go test {{PATH}} -json | tparse -all

new-migration NAME:
  atlas migrate diff --env gorm {{NAME}}

build VERSION="v0.0.1-defaultv":
  wails3 build VERSION="{{VERSION}}"

package VERSION="v0.0.1-defaultv":
  wails3 package VERSION="{{VERSION}}"

build-pi VERSION="v0.0.1-defaultv":
  wails3 build VERSION="{{VERSION}}" GOARCH=arm64
