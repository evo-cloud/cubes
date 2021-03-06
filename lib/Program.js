var Class    = require('js-class'),
    flow     = require('js-flow'),
    plugins  = require('js-plugins'),
    elements = require('evo-elements'),
    Errors  = elements.Errors,
    neuron   = require('evo-neuron'),
    idioms   = require('evo-idioms'),

    EntityStore = require('./EntityStore'),
    BlobStore   = require('./BlobStore');
    //KeyWatcher  = require('./KeyWatcher');

var ENGINE_DEFAULTS = {
    entity: {
        name: 'tingodb',
        file: '/tmp/evo-cubes.db',
        options: {}
    },
    blob: {
        name: 'filesystem',
        path: '/tmp/blobs'
    }
};

var Program = Class(neuron.Program, {
    constructor: function () {
        //neuron.Program.prototype.constructor.call(this, 'cubes', { neuron: { connects: ['connector'] } });
        neuron.Program.prototype.constructor.call(this, 'cubes');

        //this.connector = new idioms.ConnectorClient(this.neuron);
        //this.keyWatcher = new KeyWatcher(this.connector, this.options, this.logger);

        this
            .dispatch('blob.upload',   { schema: { path: 'string' } })
            .dispatch('blob.info',     { schema: { ids: { array: 'string' } } })
            .dispatch('blob.request',  { schema: { id: 'string' } })
            .dispatch('blob.release',  { schema: { id: 'string' } })
            .dispatch('blob.cleanup')
            .dispatch('op.list')
            .dispatch('op.abort',      { schema: { opId: 'string' } })
            .dispatch('entity.create', { schema: { type: 'string', id: 'string', data: { nullable: 'object' } } })
            .dispatch('entity.update', { schema: { type: 'string', id: 'string', rev: 'string', data: { nullable: 'object' }, options: { nullable: 'object' } } })
            .dispatch('entity.select', { schema: { type: 'string', method: ['id', 'part'], keys: 'array', options: { nullable: 'object' } } })
            .dispatch('entity.remove', { schema: { type: 'string', ids: { array: 'string' } } })
            //.dispatch('kv.watch',      { schema: { keys: { array: 'string' } } })
            //.dispatch('kv.publish',    { schema: { key: 'string', value: { nullable: 'object' } }, options: { all: true } })
        ;
    },

    run: function () {
        var engines = this.options.engines || {};
        flow.each(['entity', 'blob'])
            .do(function (name, next) {
                var engineConf = engines[name] || ENGINE_DEFAULTS[name];
                plugins.connect(this, 'evo-cubes:engine.' + name, {
                    name: engineConf.name,
                    data: { conf: engineConf, logger: this.logger },
                    required: true,
                }, function (err, engine) {
                    !err && engine && (this[name + 'Engine'] = engine);
                    next(err);
                }.bind(this));
            })
            .with(this)
            .run(function (err) {
                if (err) {
                    process.emit('error', err);
                } else {
                    this.entityStore = new EntityStore(this.entityEngine, this.logger);
                    (this.blobStore = new BlobStore(this.blobEngine, this.options, this.logger))
                        .on('progress', this.onOpProgress.bind(this))
                        .on('complete', this.onOpComplete.bind(this))
                    ;
                    neuron.Program.prototype.run.call(this);
                }
            });
    },

    'neuron:blob.upload': function (req, params) {
        this.blobStore.upload(req.src, params.path, req.done);
    },

    'neuron:blob.info': function (req, params) {
        this.blobStore.info(params.ids, function (err, info) {
            req.ok(err || { info: info });
        });
    },

    'neuron:blob.request': function (req, params) {
        this.blobStore.request(req.src, params.id, req.done);
    },

    'neuron:blob.release': function (req, params) {
        this.blobStore.release(req.src, params.id, req.done);
    },

    'neuron:blob.cleanup': function (req) {
        this.blobStore.cleanup(parseInt(req.data.delay));
        req.ok();
    },

    'neuron:op.list': function (req) {
        this.blobStore.listOps(req.src, function (err, ops) {
            req.ok(err || ops);
        });
    },

    'neuron:op.abort': function (req, params) {
        var op = this.ops.find(params.opId, req.src);
        if (op) {
            req.ok();
            op.abort();
        } else {
            req.fail(Errors.nonexist(params.opId));
        }
    },

    'neuron:entity.create': function (req, params) {
        this.entityStore.create(params.type, params.id, params.data, function (err, entity) {
            req.ok(err || entity);
        });
    },

    'neuron:entity.update': function (req, params) {
        this.entityStore.update(params.type, params.id, params.rev, params.data, params.options, req.done);
    },

    'neuron:entity.select': function (req, params) {
        this.entityStore.select(params.type, params.method, params.keys, params.options, req.done);
    },

    'neuron:entity.remove': function (req, params) {
        this.entityStore.remove(params.type, params.ids, req.done);
    },

    //'neuron:kv.watch': function (req, params) {
    //    this.keyWatcher.watch(params.keys, req.src, req.done);
    //},
    //
    //'neuron:kv.publish': function (req, params) {
    //    this.keyWatcher.publish(params.key, params.value, params, req.src, req.done);
    //},

    onDisconnect: function (id) {
        this.blobStore.disconnect(id);
        //this.keyWatcher.disconnect(id);
    },

    onOpProgress: function (opId, percentage, clients) {
        this.neuron.cast({
            event: 'op.progress',
            data: {
                opId: opId,
                progress: percentage
            }
        }, { target: clients });
    },

    onOpComplete: function (opId, err, clients) {
        var errData = err ? neuron.Message.err(err).data : undefined;
        this.neuron.cast({
            event: 'op.complete',
            data: {
                opId: opId,
                success: !err,
                error: errData
            }
        }, { target: clients });
    }
}, {
    statics: {
        run: function () {
            plugins.instance.scan();
            new Program().run();
        }
    }
});

module.exports = Program;
