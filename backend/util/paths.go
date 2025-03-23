package util

import (
	"io/fs"
	"path/filepath"
)

func FindAllNestedFilesWithExtension(root, ext string) []string {
	var result []string
	filepath.WalkDir(root, func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		fileName := d.Name()
		if filepath.Ext(fileName) == ext {
			result = append(result, path)
		}
		return nil
	})
	return result
}
