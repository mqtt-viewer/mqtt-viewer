package app

// func TestProtoRegistryIsLoadedCorrectly(t *testing.T) {
// 	app := getTestApp(t)

// 	newConnection, _ := app.NewConnection()
// 	appConnection := app.AppConnections[newConnection.ConnectionDetails.ID]
// 	isProtoEnabled := true
// 	appConnection.Connection.IsProtoEnabled = &isProtoEnabled
// 	appConnection.Connection.ProtoRegDir = null.NewString(path.Join(appDir, "./test-protos"), true)
// 	app.UpdateConnection(appConnection.Connection)

// 	res, err := app.LoadProtoRegistry(newConnection.ConnectionDetails.ID)
// 	if err != nil {
// 		t.Errorf("Expected no error, got %v", err)
// 		return
// 	}

// 	if res.Dir != path.Join(appDir, "./test-protos") {
// 		t.Errorf("Expected dir to be %v, got %v", path.Join(appDir, "./test-protos"), res.Dir)
// 	}

// 	if len(res.LoadedFileNamesWithDescriptors) != 2 {
// 		t.Errorf("Expected 2 file names, got %v", len(res.LoadedFileNamesWithDescriptors))
// 	}
// }
