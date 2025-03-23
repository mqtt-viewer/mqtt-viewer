package update

import (
	"fmt"
	"log"
	"log/slog"
	"os"
	"os/exec"
	"path"
	"runtime"
	"strings"

	"syscall"
)

func restartSelf() {
	self, err := os.Executable()
	if err != nil {
		log.Panic(err)
		return
	}

	if runtime.GOOS == "linux" {
		fileName := path.Base(self)
		fileDir := path.Dir(self)
		fileName = strings.TrimPrefix(fileName, ".")
		fileName = strings.TrimSuffix(fileName, ".old")

		self = path.Join(fileDir, fileName)
	}

	slog.Info(fmt.Sprintf("restarting self: %s", self))
	args := os.Args
	env := os.Environ()

	// Windows does not support exec syscall.
	if runtime.GOOS == "windows" {
		cmd := exec.Command(self, args[1:]...)
		cmd.Env = env
		if err := cmd.Start(); err == nil {
			os.Exit(0)
		}
	} else {
		err := syscall.Exec(self, args, env)
		if err != nil {
			log.Panic(err)
			return
		}
	}
}
