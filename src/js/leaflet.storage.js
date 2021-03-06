L.Map.mergeOptions({
    base_layers: null,
    overlay_layers: null,
    categories: [],
    zoom: 10,
    hash: true,
    embedControl: true,
    layersControl: true,
    default_color: "DarkBlue",
    default_smoothFactor: 1.0,
    default_opacity: 0.5,
    default_fillOpacity: 0.3,
    default_stroke: true,
    default_fill: true,
    default_weight: 3,
    default_iconClass: "Default",
    attributionControl: false,
    storageAttributionControl: true,
    allowEdit: true,
    homeControl: true,
    zoomControl: false,  // Not to activate initHook, which make zoom comes before homeControl
    storageZoomControl: true,
    locateControl: true,
    jumpToLocationControl: true,
    editInOSMControl: false,
    editInOSMControlOptions: {},
    scaleControl: true,
    miniMap: false
});

L.Storage.Map.include({
    initialize: function (/* DOM element or id*/ el, /* Object*/ options) {
        // We manage it, so don't use Leaflet default behaviour
        if (options.locale) {
            L.S.setLocale(options.locale);
        }
        var center = options.center;
        delete options.center;
        var editInOSMControl = options.editInOSMControl;
        delete options.editInOSMControl;
        L.Map.prototype.initialize.call(this, el, options);
        this.options.center = center;
        if (this.options.storageZoomControl) {
            // Calling parent has called the initHook, we can now add the
            // zoom control
            this.zoomControl = new L.Control.Zoom();
            this.addControl(this.zoomControl);
        }
        if (editInOSMControl) {
            this.editInOSMControl = (new L.Control.EditInOSM(this.options.editInOSMControlOptions)).addTo(this);
        }
        if (this.options.scaleControl) {
            this.scaleControl = L.control.scale().addTo(this);
        }

        // User must provide a pk
        if (typeof this.options.storage_id == "undefined") {
            alert("ImplementationError: you must provide a storage_id for Storage.Map.");
        }

        var edited_feature = null;
        this.__defineGetter__("edited_feature", function(){
            return edited_feature;
        });

        this.__defineSetter__("edited_feature", function(feature){
            if (edited_feature && edited_feature != feature) {
                edited_feature.endEdit();
            }
            edited_feature = feature;
        });

        if (this.options.allowEdit) {
            // Layer for items added by users
            var drawnItems = new L.LayerGroup();
            this.on('draw:marker-created', function (e) {
                drawnItems.addLayer(e.marker);
                e.marker.edit(e);
            });
            this.on('draw:poly-created', function (e) {
                drawnItems.addLayer(e.poly);
                e.poly.editing.enable();
                if (!e.latlng) {
                    e.latlng = e.poly._latlngs[e.poly._latlngs.length-1];
                }
                e.poly.edit(e);
            });
            this.on("popupclose", function(e) {
                // remove source if it has not been created (no storage_id)
                var layer = e.popup._source;
                var id = L.Util.stamp(layer);
                if(drawnItems._layers.hasOwnProperty(id)
                    && !layer.storage_id) {
                    drawnItems.removeLayer(layer);
                }
            });
            this.addLayer(drawnItems);
            L.Storage.on('ui:end', function (e) {
                this.edited_feature = null;
            }, this);
        }


        if (this.options.hash) {
            this.addHash();
        }
        this.initCenter();


        // Init control layers
        // It will be populated while creating the overlays
        // Control is added as an initHook, to keep the order
        // with other controls
        this.storage_layers_control = new L.Storage.ControlLayers();
        this.populateTileLayers(this.options.tilelayers);
        if (this.options.layersControl) {
            this.addControl(this.storage_layers_control);
        }

        // Global storage for retrieving overlays
        this.storage_overlays = {};
        this.marker_to_overlay = {};
        // create overlays
        for(var j in this.options.categories) {
            if(this.options.categories.hasOwnProperty(j)){
                this._createOverlay(this.options.categories[j]);
            }
        }
    },

    populateTileLayers: function (tilelayers) {
        this.tilelayers = {};
        for(var i in tilelayers) {
            if(tilelayers.hasOwnProperty(i)) {
                this.addTileLayer(tilelayers[i]);
            }
        }
        this.storage_layers_control._update();
    },

    resetTileLayers: function () {
        for(var i in this.tilelayers) {
            if(this.tilelayers.hasOwnProperty(i)) {
                this.removeLayer(this.tilelayers[i]);
                this.storage_layers_control.removeLayer(this.tilelayers[i]);
            }
        }
    },

    createTileLayer: function (options) {
        return new L.TileLayer(
            options.tilelayer.url_template,
            {
                attribution: options.tilelayer.attribution,
                minZoom: options.tilelayer.minZoom,
                maxZoom: options.tilelayer.maxZoom
            }
        );
    },

    addTileLayer: function (options) {
        var tilelayer = this.createTileLayer(options);
        // Add only the first to the map, to make it visible,
        // and the other only when user click on them
        if(options.rank == 1) {
            this.addLayer(tilelayer);
            if (this.options.miniMap) {
                if (typeof this.miniMap === "object") {
                    this.removeControl(this.miniMap);
                }
                this.whenReady(function () {
                    this.miniMap = new L.Control.MiniMap(this.createTileLayer(options)).addTo(this);
                })
            }
        }
        this.storage_layers_control._addLayer(tilelayer, options.tilelayer.name);
        this.tilelayers[options.tilelayer.name] = tilelayer;
    },

    initCenter: function () {
        if (this.options.hash && this._hash.parseHash(location.hash)) {
            // FIXME An invalid hash will cause the load to fail
            this._hash.update();
        }
        else if(this.options.locate && this.options.locate.setView) {
            // Prevent from making two setViews at init
            // which is not very fluid...
            this.locate(this.options.locate);
        }
        else {
            this.options.center = this.latLng(this.options.center);
            this.setView(this.options.center, this.options.zoom);
        }
    },

    latLng: function(a, b, c) {
        // manage geojson case and call original method
        if (!(a instanceof L.LatLng) && a.coordinates) {
            // Guess it's a geojson
            a = Array(a.coordinates[1], a.coordinates[0]);
        }
        return L.latLng(a, b, c);
    },

    _createOverlay: function(category) {
        return new L.Storage.Layer(this, category);
    },

    getDefaultOption: function (option) {
        return this.options["default_" + option] || null;
    },

    updateExtent: function() {
        // Save in db the current center and zoom
        var latlng = this.getCenter(),
            zoom = this.getZoom(),
            center = {
                type: "Point",
                coordinates: [
                    latlng.lng,
                    latlng.lat
                ]
            },
            url = L.Util.template(this.options.urls.map_update_extent, {'map_id': this.options.storage_id}),
            formData = new FormData();
            formData.append('center', JSON.stringify(center));
            formData.append('zoom', zoom);
        L.Storage.Xhr.post(url, {
            'data': formData
        });
    },

    updateTileLayers: function () {
        var url = L.Util.template(this.options.urls.map_update_tilelayers, {'map_id': this.options.storage_id}),
            self = this;
        L.Storage.Xhr.get(url, {
            "listen_form": {
                'id': 'map_edit',
                'options': {
                    'success': function (data) {
                        if (data.tilelayers) {
                            self.resetTileLayers();
                            self.populateTileLayers(data.tilelayers);
                            L.Storage.fire('ui:end');
                            L.Storage.fire('ui:alert', {'content': L.S._('Successfully updated tilelayers'), 'level': 'info'});
                        }
                        else {
                            L.Storage.fire('ui:alert', {'content': 'Invalid response', 'level': 'error'});
                        }
                    }
                }
            }
        });
    },

    updateInfos: function () {
        var url = L.Util.template(this.options.urls.map_update, {'map_id': this.options.storage_id});
        L.Storage.Xhr.get(url, {
            'listen_form': {'id': 'map_edit'},  // 1. edit form
            'listen_link': {
                'id': 'delete_map_button',  // 2. delete link
                'options': {
                    'listen_form': {'id': 'map_delete'},  // 3. confirm delete form
                    'cssClass': 'warning'
                }
            }
        });
    },

    updatePermissions: function () {
        var url = L.Util.template(this.options.urls.map_update_permissions, {'map_id': this.options.storage_id});
        L.Storage.Xhr.get(url, {
            'listen_form': {'id': 'map_edit'}
        });
    },

    updateSettings: function () {
        var url = L.Util.template(this.options.urls.map_update_settings, {'map_id': this.options.storage_id});
        L.Storage.Xhr.get(url, {
            'listen_form': {'id': 'map_edit'}
        });
    },

    uploadData: function () {
        var map = this;
        var handle_response = function (data) {
            L.Storage.fire("ui:start", {'data': data, "cssClass": "upload-data"});
            var form_id = "upload_data",
                urlHelper = new L.Storage.FormHelper.ImportURL(map, form_id, {});
            L.Storage.Xhr.listen_form(form_id, {
                'callback': function (data) {
                    if (data.category) {
                        var layer = map.storage_overlays[data.category.pk];
                        layer.on('dataloaded', function (e) {
                            var bounds = layer.getBounds();
                            if (bounds.isValid()) {
                                map.fitBounds(bounds);
                            }
                        });
                        layer.clearLayers();
                        layer.fetchData();
                        L.Storage.fire('ui:end');
                        if (data.info) {
                            L.Storage.fire("ui:alert", {"content": data.info, "level": "info"});
                        }
                    }
                    else if (data.error) {
                        L.Storage.fire("ui:alert", {"content": data.error, "level": "error"});
                    }
                    else {
                        // start again
                        handle_response(data);
                    }
                }
            });
        };
        var url = L.Util.template(this.options.urls.upload_data, {'map_id': this.options.storage_id});
        L.Storage.Xhr.get(url, {
            'callback': handle_response
        });
    }

});