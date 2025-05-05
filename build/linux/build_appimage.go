// Heavily modified port of the v3 wails appimage build code
// https://github.com/wailsapp/wails/blob/v3.0.0-alpha.9/v3/internal/commands/appimage.go
// with commands copied from
// https://github.com/wailsapp/wails/blob/v3.0.0-alpha.9/v3/internal/s/s.go
package main

import (
	"crypto/md5"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/google/shlex"
)

//go:embed linuxdeploy-plugin-gtk.sh
var gtkPlugin []byte

type GenerateAppImageOptions struct {
	Binary      string `description:"The binary to package including path"`
	Icon        string `description:"Path to the icon"`
	DesktopFile string `description:"Path to the desktop file"`
	OutputDir   string `description:"Path to the output directory" default:"."`
	BuildDir    string `description:"Path to the build directory"`
}

func getCurrentDir() string {
	_, filename, _, ok := runtime.Caller(1)
	if !ok {
		panic("Could not get caller information")
	}
	return filepath.Dir(filename)
}

var (
	currentDir      = getCurrentDir()
	buildDir        = path.Join(currentDir, "./appimage/build")
	outputDir       = path.Join(currentDir, ".")
	name            = "MQTTViewer"
	binaryPath      = path.Join(currentDir, "../bin/MQTTViewer")
	iconPath        = path.Join(currentDir, "../appicon.png")
	desktopFilePath = path.Join(currentDir, "./MQTTViewer.desktop")
)

func main() {

	// Architecture-specific variables using a map
	archDetails := map[string]string{
		"arm64":  "aarch64",
		"amd64":  "x86_64",
		"x86_64": "x86_64",
	}

	arch, exists := archDetails[runtime.GOARCH]
	if !exists {
		fmt.Printf("Unsupported architecture: %s\n", runtime.GOARCH)
		os.Exit(1)
	}

	appDir := filepath.Join(buildDir, fmt.Sprintf("%s-%s.AppDir", name, arch))

	// Remove existing app directory if it exists
	if _, err := os.Stat(appDir); err == nil {
		err = os.RemoveAll(appDir)
		if err != nil {
			panic(fmt.Sprintf("failed to remove existing app directory: %s", err))
		}
	}

	usrBin := filepath.Join(appDir, "usr", "bin")
	MKDIR(buildDir)
	MKDIR(usrBin)
	COPY(binaryPath, usrBin)
	CHMOD(filepath.Join(usrBin, filepath.Base(binaryPath)), 0755)
	dotDirIcon := filepath.Join(appDir, ".DirIcon")
	COPY(iconPath, dotDirIcon)
	iconLink := filepath.Join(appDir, filepath.Base(iconPath))
	DELETE(iconLink)
	SYMLINK(".DirIcon", iconLink)
	COPY(desktopFilePath, appDir)

	// Download linuxdeploy and make it executable
	CD(buildDir)

	// Download URLs using a map based on architecture
	urls := map[string]string{
		"linuxdeploy": fmt.Sprintf("https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-%s.AppImage", arch),
		"AppRun":      fmt.Sprintf("https://github.com/AppImage/AppImageKit/releases/download/continuous/AppRun-%s", arch),
	}

	// Download necessary files concurrently
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		linuxdeployPath := filepath.Join(buildDir, filepath.Base(urls["linuxdeploy"]))
		if !EXISTS(linuxdeployPath) {
			DOWNLOAD(urls["linuxdeploy"], linuxdeployPath)
		}
		CHMOD(linuxdeployPath, 0755)
		wg.Done()
	}()

	go func() {
		target := filepath.Join(appDir, "AppRun")
		if !EXISTS(target) {
			DOWNLOAD(urls["AppRun"], target)
		}
		CHMOD(target, 0755)
		wg.Done()
	}()

	wg.Wait()

	// Processing GTK files
	filesNeeded := []string{"WebKitWebProcess", "WebKitNetworkProcess", "libwebkit2gtkinjectedbundle.so"}
	files, err := findGTKFiles(filesNeeded)
	if err != nil {
		fmt.Println("Error finding GTK files:", err)
		os.Exit(1)
	}
	CD(appDir)
	for _, file := range files {
		targetDir := filepath.Dir(file)
		if targetDir[0] == '/' {
			targetDir = targetDir[1:]
		}
		targetDir, err = filepath.Abs(targetDir)
		if err != nil {
			fmt.Println("Error getting absolute path:", err)
			os.Exit(1)
		}
		MKDIR(targetDir)
		COPY(file, targetDir)
	}

	// Copy GTK Plugin
	err = os.WriteFile(filepath.Join(buildDir, "linuxdeploy-plugin-gtk.sh"), gtkPlugin, 0755)
	if err != nil {
		fmt.Println("Error writing GTK plugin:", err)
		os.Exit(1)
	}

	// Determine GTK Version
	targetBinary := filepath.Join(appDir, "usr", "bin", binaryPath)
	lddOutput, err := EXEC(fmt.Sprintf("ldd %s", targetBinary))
	if err != nil {
		println(string(lddOutput))
		os.Exit(1)
	}
	lddString := string(lddOutput)
	var DeployGtkVersion string
	switch {
	case CONTAINS(lddString, "libgtk-x11-2.0.so"):
		DeployGtkVersion = "2"
	case CONTAINS(lddString, "libgtk-3.so"):
		DeployGtkVersion = "3"
	case CONTAINS(lddString, "libgtk-4.so"):
		DeployGtkVersion = "4"
	default:
		fmt.Println("Unable to determine GTK version")
		os.Exit(1)
	}

	// Run linuxdeploy to bundle the application
	CD(buildDir)
	linuxdeployAppImage := filepath.Join(buildDir, fmt.Sprintf("linuxdeploy-%s.AppImage", arch))

	cmd := fmt.Sprintf("%s --appimage-extract-and-run --appdir %s --output appimage --plugin gtk", linuxdeployAppImage, appDir)
	SETENV("DEPLOY_GTK_VERSION", DeployGtkVersion)
	output, err := EXEC(cmd)
	if err != nil {
		println(output)
		fmt.Println("Error running linuxdeploy:", err)
		os.Exit(1)
	}

	// Move file to output directory
	targetFile := filepath.Join(buildDir, fmt.Sprintf("%s-%s.AppImage", name, arch))
	MOVE(targetFile, outputDir)

	fmt.Println("AppImage created successfully:", targetFile)

	// zipping app image
	zipFile := filepath.Join(outputDir, fmt.Sprintf("%s-%s.AppImage.zip", name, arch))
	zipCmd := fmt.Sprintf("zip -r %s %s", zipFile, targetFile)
	zipOutput, err := EXEC(zipCmd)
	if err != nil {
		println(zipOutput)
		fmt.Println("Error zipping AppImage:", err)
		os.Exit(1)
	}
	fmt.Println("AppImage zipped successfully:", zipFile)
}

func findGTKFiles(files []string) ([]string, error) {
	notFound := []string{}
	found := []string{}
	err := filepath.Walk("/usr/", func(path string, info os.FileInfo, err error) error {
		if err != nil {
			if os.IsPermission(err) {
				return nil
			}
			return err
		}

		if info.IsDir() {
			return nil
		}

		for _, fileName := range files {
			if strings.HasSuffix(path, fileName) {
				found = append(found, path)
				break
			}
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, fileName := range files {
		fileFound := false
		for _, foundPath := range found {
			if strings.HasSuffix(foundPath, fileName) {
				fileFound = true
				break
			}
		}
		if !fileFound {
			notFound = append(notFound, fileName)
		}
	}
	if len(notFound) > 0 {
		return nil, errors.New("Unable to locate all required files: " + strings.Join(notFound, ", "))
	}
	return found, nil
}

func checkError(err error) {
	if err != nil {
		fmt.Println("Error:", err)
		os.Exit(1)
	}
}

// RENAME a file or directory
func RENAME(source string, target string) {
	err := os.Rename(source, target)
	checkError(err)
}

// MUSTDELETE a file.
func MUSTDELETE(filename string) {
	err := os.Remove(filepath.Join(CWD(), filename))
	checkError(err)
}

// DELETE a file.
func DELETE(filename string) {
	_ = os.Remove(filepath.Join(CWD(), filename))
}

func CONTAINS(list string, item string) bool {
	result := strings.Contains(list, item)
	listTrimmed := list
	if len(listTrimmed) > 30 {
		listTrimmed = listTrimmed[:30] + "..."
	}
	return result
}

func SETENV(key string, value string) {
	err := os.Setenv(key, value)
	checkError(err)
}

func CD(dir string) {
	err := os.Chdir(dir)
	checkError(err)
}
func MKDIR(path string, mode ...os.FileMode) {
	var perms os.FileMode
	perms = 0755
	if len(mode) == 1 {
		perms = mode[0]
	}
	err := os.MkdirAll(path, perms)
	checkError(err)
}

// ENDIR ensures that the path gets created if it doesn't exist
func ENDIR(path string, mode ...os.FileMode) {
	var perms os.FileMode
	perms = 0755
	if len(mode) == 1 {
		perms = mode[0]
	}
	_ = os.MkdirAll(path, perms)
}

// COPYDIR recursively copies a directory tree, attempting to preserve permissions.
// Source directory must exist, destination directory must *not* exist.
// Symlinks are ignored and skipped.
// Credit: https://gist.github.com/r0l1/92462b38df26839a3ca324697c8cba04
func COPYDIR(src string, dst string) {
	src = filepath.Clean(src)
	dst = filepath.Clean(dst)

	si, err := os.Stat(src)
	checkError(err)
	if !si.IsDir() {
		checkError(fmt.Errorf("source is not a directory"))
	}

	_, err = os.Stat(dst)
	if err != nil && !os.IsNotExist(err) {
		checkError(err)
	}
	if err == nil {
		checkError(fmt.Errorf("destination already exists"))
	}

	MKDIR(dst)

	entries, err := os.ReadDir(src)
	checkError(err)

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			COPYDIR(srcPath, dstPath)
		} else {
			// Skip symlinks.
			if entry.Type()&os.ModeSymlink != 0 {
				continue
			}

			COPY(srcPath, dstPath)
		}
	}
}

// COPYDIR2 recursively copies a directory tree, attempting to preserve permissions.
// Source directory must exist, destination directory can exist.
// Symlinks are ignored and skipped.
// Credit: https://gist.github.com/r0l1/92462b38df26839a3ca324697c8cba04
func COPYDIR2(src string, dst string) {
	src = filepath.Clean(src)
	dst = filepath.Clean(dst)

	si, err := os.Stat(src)
	checkError(err)
	if !si.IsDir() {
		checkError(fmt.Errorf("source is not a directory"))
	}

	MKDIR(dst)

	entries, err := os.ReadDir(src)
	checkError(err)

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			COPYDIR(srcPath, dstPath)
		} else {
			// Skip symlinks.
			if entry.Type()&os.ModeSymlink != 0 {
				continue
			}

			COPY(srcPath, dstPath)
		}
	}
}

func SYMLINK(source string, target string) {
	// trim string to first 30 chars
	var trimTarget = target
	if len(trimTarget) > 30 {
		trimTarget = trimTarget[:30] + "..."
	}
	err := os.Symlink(source, target)
	checkError(err)
}

// COPY file from source to target
func COPY(source string, target string) {
	src, err := os.Open(source)
	checkError(err)
	defer closefile(src)
	if ISDIR(target) {
		target = filepath.Join(target, filepath.Base(source))
	}
	d, err := os.Create(target)
	checkError(err)
	_, err = io.Copy(d, src)
	checkError(err)
}

// Move file from source to target
func MOVE(source string, target string) {
	// If target is a directory, append the source filename
	if ISDIR(target) {
		target = filepath.Join(target, filepath.Base(source))
	}
	err := os.Rename(source, target)
	checkError(err)
}

func CWD() string {
	result, err := os.Getwd()
	checkError(err)
	return result
}

func RMDIR(target string) {
	err := os.RemoveAll(target)
	checkError(err)
}

func RM(target string) {
	err := os.Remove(target)
	checkError(err)
}

func ECHO(message string) {
	println(message)
}

func TOUCH(filepath string) {
	f, err := os.Create(filepath)
	checkError(err)
	closefile(f)
}

func EXEC(command string) ([]byte, error) {
	// Split input using shlex
	args, err := shlex.Split(command)
	checkError(err)
	// Execute command
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Dir = CWD()
	cmd.Env = os.Environ()
	return cmd.CombinedOutput()
}

func CHMOD(path string, mode os.FileMode) {
	err := os.Chmod(path, mode)
	checkError(err)
}

// EXISTS - Returns true if the given path exists
func EXISTS(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

// ISDIR returns true if the given directory exists
func ISDIR(path string) bool {
	fi, err := os.Lstat(path)
	if err != nil {
		return false
	}

	return fi.Mode().IsDir()
}

// ISDIREMPTY returns true if the given directory is empty
func ISDIREMPTY(dir string) bool {

	// CREDIT: https://stackoverflow.com/a/30708914/8325411
	f, err := os.Open(dir)
	checkError(err)
	defer closefile(f)

	_, err = f.Readdirnames(1) // Or f.Readdir(1)
	if err == io.EOF {
		return true
	}
	return false
}

// ISFILE returns true if the given file exists
func ISFILE(path string) bool {
	fi, err := os.Lstat(path)
	if err != nil {
		return false
	}

	return fi.Mode().IsRegular()
}

// SUBDIRS returns a list of subdirectories for the given directory
func SUBDIRS(rootDir string) []string {
	var result []string

	// Iterate root dir
	err := filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		checkError(err)
		// If we have a directory, save it
		if info.IsDir() {
			result = append(result, path)
		}
		return nil
	})
	checkError(err)
	return result
}

// SAVESTRING will create a file with the given string
func SAVESTRING(filename string, data string) {
	SAVEBYTES(filename, []byte(data))
}

// LOADSTRING returns the contents of the given filename as a string
func LOADSTRING(filename string) string {
	data := LOADBYTES(filename)
	return string(data)
}

// SAVEBYTES will create a file with the given string
func SAVEBYTES(filename string, data []byte) {
	err := os.WriteFile(filename, data, 0755)
	checkError(err)
}

// LOADBYTES returns the contents of the given filename as a string
func LOADBYTES(filename string) []byte {
	data, err := os.ReadFile(filename)
	checkError(err)
	return data
}

func closefile(f *os.File) {
	err := f.Close()
	checkError(err)
}

// MD5FILE returns the md5sum of the given file
func MD5FILE(filename string) string {
	f, err := os.Open(filename)
	checkError(err)
	defer closefile(f)

	h := md5.New()
	_, err = io.Copy(h, f)
	checkError(err)

	return fmt.Sprintf("%x", h.Sum(nil))
}

// Sub is the substitution type
type Sub map[string]string

// REPLACEALL replaces all substitution keys with associated values in the given file
func REPLACEALL(filename string, substitutions Sub) {
	data := LOADSTRING(filename)
	for old, newText := range substitutions {
		data = strings.ReplaceAll(data, old, newText)
	}
	SAVESTRING(filename, data)
}

func DOWNLOAD(url string, target string) {
	// create HTTP client
	resp, err := http.Get(url)
	checkError(err)
	defer resp.Body.Close()

	out, err := os.Create(target)
	checkError(err)
	defer out.Close()

	// Write the body to file
	_, err = io.Copy(out, resp.Body)
	checkError(err)
}

func FINDFILES(root string, filenames ...string) []string {
	var result []string
	// Walk the root directory trying to find all the files
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		checkError(err)
		// If we have a file, check if it is in the list
		if info.Mode().IsRegular() {
			for _, filename := range filenames {
				if info.Name() == filename {
					result = append(result, path)
				}
			}
		}
		return nil
	})
	checkError(err)
	return result
}
