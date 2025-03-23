# MQTT Viewer

[MQTT Viewer](https://mqttviewer.app) is a feature-rich and performant MQTT visualisation and debugging tool for Windows, Mac and Linux.

[Download MQTT Viewer](https://github.com/mqtt-viewer/mqtt-viewer/releases)

![Screenshot of MQTT Viewer](docs/images/screenshot.png)

## Features

First and foremost, MQTT Viewer is fast, responsive and easy to use.

But wait, there's more:

| Feature                                  | Status | Comments                                                                                                                                                                                                     |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Topic tree data visualisation            | ✅     |                                                                                                                                                                                                              |
| MQTT v3 + v5 compatibility               | ✅     |                                                                                                                                                                                                              |
| Run multiple concurrent connections      | ✅     | Up to 10 supported.                                                                                                                                                                                          |
| Message publishing (+ v5 headers)        | ✅     |                                                                                                                                                                                                              |
| Interactive message timeline             | ✅     |                                                                                                                                                                                                              |
| Message comparison                       | ✅     | Currently only compares to previous message but I'm planning on making this more flexible.                                                                                                                   |
| Base64 + Hex + Protobuf codecs           | ✅     | I'm thinking about redesigning how Protobuf encoding / decoding works. Please let me know here if you have thoughts on this.                                                                                 |
| Free-text / pattern-based filters        | ✅     | ⭐ New! Let me know your thoughts on this here.                                                                                                                                                              |
| Publish history                          | ✅     | ⭐ New! Let me know your thoughts on this here.                                                                                                                                                              |
| Saved message collections                | 🚧     | In progress                                                                                                                                                                                                  |
| Client logs                              | 🚧     | In progress                                                                                                                                                                                                  |
| Broker status page (based on $SYS data)  | ❓     | Potential. Let me know if you might use this [here](https://github.com/mqtt-viewer/mqtt-viewer/discussions/1).                                                                                               |
| In-app local test broker                 | ❓     | Potential. This would be an alternative to running a local mosquitto instance for debugging/development. Let me know if you might use this [here](https://github.com/mqtt-viewer/mqtt-viewer/discussions/2). |
| Team workspaces + cloud collections sync | ❓     | Potential. Let me know if you might use this [here](https://github.com/mqtt-viewer/mqtt-viewer/discussions/3).                                                                                               |

Don't see a feature that would make your life easier? [I really, really want to know.](https://github.com/mqtt-viewer/mqtt-viewer/issues/new?template=feature_idea.yml)

## Contributing

> [!WARNING]
> The move to make this codebase open-source was a very recent decision. Considering I didn't expect this code to ever see the light of day, there's a lot of internal cleanup, dependency updates and documentation that needs to be completed before I start accepting code contributions 🫧🧴📝

If MQTT Viewer has been helpful, right now the best ways to contribute are:

- Reporting bugs and making feature requests via [GitHub issues](https://github.com/mqtt-viewer/mqtt-viewer/issues)
- Giving me honest, constructive feedback about what you like and don't like about MQTT Viewer via [GitHub discussions](https://github.com/mqtt-viewer/mqtt-viewer/discussions).
- Seriously, nothing is too big or too small. [Let me know](https://github.com/mqtt-viewer/mqtt-viewer/issues) how to make MQTT Viewer better for you.
- Letting others know about MQTT Viewer on your favourite social media or blogs.
- Leaving MQTT Viewer [a testimonal!](https://testimonial.to/mqtt-viewer/)

## License

MQTT Viewer is open-source under [GPLv3](https://www.gnu.org/licenses/gpl-3.0.html).

All features are currently available to use freely.
