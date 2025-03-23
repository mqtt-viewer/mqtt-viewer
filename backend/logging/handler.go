package logging

import (
	"context"
	"log/slog"
)

type ctxKey string

const (
	slogFields ctxKey = "slog_fields"
)

type ContextHandler struct {
	slog.Handler
}

// Handle adds contextual attributes to the Record before calling the underlying
// handler
func (h ContextHandler) Handle(ctx context.Context, r slog.Record) error {
	if attrs, ok := ctx.Value(slogFields).([]slog.Attr); ok {
		for _, v := range attrs {
			r.AddAttrs(v)
		}
	}

	return h.Handler.Handle(ctx, r)
}

// AppendCtx adds an slog attribute to the provided context so that it will be
// included in any slog Record using this ctx
func AppendCtx(parent context.Context, attr slog.Attr) context.Context {
	if parent == nil {
		parent = context.Background()
	}

	if values, ok := parent.Value(slogFields).([]slog.Attr); ok {
		values = append(values, attr)
		return context.WithValue(parent, slogFields, values)
	}

	v := []slog.Attr{}
	v = append(v, attr)
	return context.WithValue(parent, slogFields, v)
}

func ReplaceCtx(parent context.Context, attr slog.Attr) context.Context {
	if parent == nil {
		parent = context.Background()
	}

	if values, ok := parent.Value(slogFields).([]slog.Attr); ok {
		for i, existingAttr := range values {
			if existingAttr.Key == attr.Key {
				values[i] = attr
				return context.WithValue(parent, slogFields, values)
			}
		}

		values = append(values, attr)
		return context.WithValue(parent, slogFields, values)
	}

	v := []slog.Attr{}
	v = append(v, attr)
	return context.WithValue(parent, slogFields, v)
}
