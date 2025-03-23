package app

import (
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) ChooseCertFile(title string) (string, error) {
	selection, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: title,
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Certificate Files (*.crt;*.cer;*.key;*.pem;*.jks;*.der;*.pfx)",
				Pattern:     "*.crt;*.cer;*.key;*.pem;*.jks;*.der;*.pfx",
			},
		},
		ShowHiddenFiles: true,
	})
	if err != nil {
		return "", err
	}
	return selection, nil
}

func (a *App) ChooseDirectory(title string) (string, error) {
	selection, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:           title,
		ShowHiddenFiles: true,
	})
	if err != nil {
		return "", err
	}
	return selection, nil
}
