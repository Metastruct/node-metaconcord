export const ffprobeSchema = {
	"metadata": {
		"title": "JSON Type Definition for FFprobe's JSON output",
	},
	"optionalProperties": {
		"program_version": {
			"ref": "program_version",
		},
		"library_version": {
			"elements": {
				"ref": "library_version",
			},
		},
		"pixel_formats": {
			"elements": {
				"ref": "pixel_format",
			},
		},
		"packets": {
			"elements": {
				"ref": "packet",
			},
		},
		"frames": {
			"elements": {
				"ref": "frame",
			},
		},
		"packets_and_frames": {
			"elements": {
				"discriminator": "type",
				"mapping": {
					"frame": {
						"properties": {},
					},
					"packet": {
						"properties": {},
					},
				},
			},
		},
		"programs": {
			"elements": {
				"ref": "program",
			},
		},
		"streams": {
			"elements": {
				"ref": "stream",
			},
		},
		"format": {
			"ref": "format",
		},
		"chapters": {
			"elements": {
				"ref": "chapter",
			},
		},
		"error": {
			"ref": "error",
		},
	},
	"definitions": {
		"program_version": {
			"properties": {
				"version": {
					"type": "string",
				},
				"copyright": {
					"type": "string",
				},
				"compiler_ident": {
					"type": "string",
				},
				"configuration": {
					"type": "string",
				},
			},
		},
		"library_version": {
			"properties": {
				"name": {
					"type": "string",
				},
				"major": {
					"type": "int32",
				},
				"minor": {
					"type": "int32",
				},
				"micro": {
					"type": "int32",
				},
				"version": {
					"type": "int32",
				},
				"ident": {
					"type": "string",
				},
			},
		},
		"pixel_format": {},
		"packet": {},
		"frame": {},
		"program": {
			"properties": {
				"program_id": {
					"type": "int32",
				},
				"program_num": {
					"type": "int32",
				},
				"nb_streams": {
					"type": "uint32",
				},
				"pmt_pid": {
					"type": "int32",
				},
				"pcr_pid": {
					"type": "int32",
				},
				"start_pts": {
					"type": "int32",
				},
				"start_time": {
					"type": "string",
				},
				"end_pts": {
					"type": "int32",
				},
				"end_time": {
					"type": "string",
				},
				"streams": {
					"elements": {
						"ref": "stream",
					},
				},
			},
			"optionalProperties": {
				"tags": {
					"values": {
						"type": "string",
					},
				},
			},
		},
		"stream": {
			"properties": {
				"index": {
					"type": "int32",
				},
				"codec_tag_string": {
					"type": "string",
				},
				"codec_tag": {
					"type": "string",
				},
			},
			"optionalProperties": {
				"codec_name": {
					"type": "string",
				},
				"codec_long_name": {
					"type": "string",
				},
				"profile": {
					"type": "string",
				},
				"codec_type": {
					"type": "string",
				},
				"width": {
					"type": "int32",
				},
				"height": {
					"type": "int32",
				},
				"coded_width": {
					"type": "int32",
				},
				"coded_height": {
					"type": "int32",
				},
				"closed_captions": {
					"type": "int32",
				},
				"has_b_frames": {
					"type": "int32",
				},
				"sample_aspect_ratio": {
					"type": "string",
				},
				"display_aspect_ratio": {
					"type": "string",
				},
				"pix_fmt": {
					"type": "string",
				},
				"level": {
					"type": "int32",
				},
				"color_range": {
					"type": "string",
				},
				"color_space": {
					"type": "string",
				},
				"color_transfer": {
					"type": "string",
				},
				"color_primaries": {
					"type": "string",
				},
				"chroma_location": {
					"type": "string",
				},
				"field_order": {
					"type": "string",
				},
				"refs": {
					"type": "int32",
				},
				"sample_fmt": {
					"type": "string",
				},
				"sample_rate": {
					"type": "string",
				},
				"channels": {
					"type": "int32",
				},
				"channel_layout": {
					"type": "string",
				},
				"bits_per_sample": {
					"type": "int32",
				},
				"id": {
					"type": "string",
				},
				"r_frame_rate": {
					"type": "string",
				},
				"avg_frame_rate": {
					"type": "string",
				},
				"time_base": {
					"type": "string",
				},
				"start_pts": {
					"type": "int32",
				},
				"start_time": {
					"type": "string",
				},
				"duration_ts": {
					"type": "int32",
				},
				"duration": {
					"type": "string",
				},
				"bit_rate": {
					"type": "string",
				},
				"max_bit_rate": {
					"type": "string",
				},
				"bits_per_raw_sample": {
					"type": "string",
				},
				"nb_frames": {
					"type": "string",
				},
				"nb_read_frames": {
					"type": "string",
				},
				"nb_read_packets": {
					"type": "string",
				},
				"disposition": {
					"ref": "disposition",
				},
				"tags": {
					"values": {
						"type": "string",
					},
				},
			},
		},
		"format": {
			"properties": {
				"filename": {
					"type": "string",
				},
				"nb_streams": {
					"type": "uint32",
				},
				"nb_programs": {
					"type": "uint32",
				},
				"format_name": {
					"type": "string",
				},
				"probe_score": {
					"type": "int32",
				},
			},
			"optionalProperties": {
				"format_long_name": {
					"type": "string",
				},
				"start_time": {
					"type": "string",
				},
				"duration": {
					"type": "string",
				},
				"size": {
					"type": "string",
				},
				"bit_rate": {
					"type": "string",
				},
				"tags": {
					"values": {
						"type": "string",
					},
				},
			},
		},
		"chapter": {
			"properties": {
				"id": {
					"type": "int32",
				},
				"time_base": {
					"type": "string",
				},
				"start": {
					"type": "int32",
				},
				"start_time": {
					"type": "string",
				},
				"end": {
					"type": "int32",
				},
				"end_time": {
					"type": "string",
				},
			},
			"optionalProperties": {
				"tags": {
					"values": {
						"type": "string",
					},
				},
			},
		},
		"disposition": {
			"properties": {
				"default": {
					"type": "int8",
				},
				"dub": {
					"type": "int8",
				},
				"original": {
					"type": "int8",
				},
				"comment": {
					"type": "int8",
				},
				"lyrics": {
					"type": "int8",
				},
				"karaoke": {
					"type": "int8",
				},
				"forced": {
					"type": "int8",
				},
				"hearing_impaired": {
					"type": "int8",
				},
				"visual_impaired": {
					"type": "int8",
				},
				"clean_effects": {
					"type": "int8",
				},
				"attached_pic": {
					"type": "int8",
				},
				"timed_thumbnails": {
					"type": "int8",
				},
				"captions": {
					"type": "int8",
				},
				"descriptions": {
					"type": "int8",
				},
				"metadata": {
					"type": "int8",
				},
				"dependent": {
					"type": "int8",
				},
				"still_image": {
					"type": "int8",
				},
			},
		},
		"error": {
			"properties": {
				"code": {
					"type": "int32",
				},
				"string": {
					"type": "string",
				},
			},
		},
	},
} as const;
