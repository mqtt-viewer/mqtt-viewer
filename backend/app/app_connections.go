package app

// Every Wails binding call runs on its own goroutine, so a connection being
// added or deleted can land while a poller is walking the map. An unsynchronised
// Go map fails that with a fatal "concurrent map read and map write" that no
// recover can catch, taking the whole app down. These helpers are the only way
// the map is touched; the field is unexported so the compiler keeps it that way.
//
// The lock covers the map, not the *AppConnection values it holds. Callers get a
// live pointer and are expected to rely on MqttManager's own internal
// synchronisation for anything they do with it.

// appConnection returns the connection record for id, if it still exists.
func (a *App) appConnection(id uint) (*AppConnection, bool) {
	a.appConnectionsMu.RLock()
	defer a.appConnectionsMu.RUnlock()
	conn, ok := a.appConnections[id]
	return conn, ok
}

// setAppConnection registers a newly created connection.
func (a *App) setAppConnection(id uint, conn *AppConnection) {
	a.appConnectionsMu.Lock()
	defer a.appConnectionsMu.Unlock()
	if a.appConnections == nil {
		a.appConnections = make(map[uint]*AppConnection)
	}
	a.appConnections[id] = conn
}

// removeAppConnection drops a deleted connection.
func (a *App) removeAppConnection(id uint) {
	a.appConnectionsMu.Lock()
	defer a.appConnectionsMu.Unlock()
	delete(a.appConnections, id)
}

// replaceAppConnections swaps in the full set built at startup.
func (a *App) replaceAppConnections(conns map[uint]*AppConnection) {
	a.appConnectionsMu.Lock()
	defer a.appConnectionsMu.Unlock()
	a.appConnections = conns
}

// appConnectionsSnapshot copies the map so callers can iterate without holding
// the lock across DB queries or MQTT calls. Values are shared pointers, so the
// snapshot can name a connection that is deleted while the caller iterates;
// that is the same window callers already had and is harmless here.
func (a *App) appConnectionsSnapshot() map[uint]*AppConnection {
	a.appConnectionsMu.RLock()
	defer a.appConnectionsMu.RUnlock()
	snapshot := make(map[uint]*AppConnection, len(a.appConnections))
	for id, conn := range a.appConnections {
		snapshot[id] = conn
	}
	return snapshot
}

// appConnectionCount reports how many connections are registered.
func (a *App) appConnectionCount() int {
	a.appConnectionsMu.RLock()
	defer a.appConnectionsMu.RUnlock()
	return len(a.appConnections)
}
