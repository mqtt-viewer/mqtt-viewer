package app

type AppMode string

type appModes struct {
	Test     AppMode
	Wails    AppMode
	WailsDev AppMode
}

var AppModes = appModes{
	Test:     "test",
	Wails:    "wails",
	WailsDev: "wails-dev",
}
