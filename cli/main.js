#!/usr/bin/env node

var AWS = require("aws-sdk");
var proxy = require('proxy-agent');
const fs = require('fs');
const util = require('util');
const path = require('path');
const process = require('process');
const deepmerge = require('deepmerge');
const cliargs = require('commander');
const cliprogress = require('cli-progress');
const logplease = require('logplease');
const _colors = require('colors');
const pjson = require('./package.json');
const CLI = true;

logplease.setLogLevel('NONE');
const awslog = logplease.create('AWS');
AWS.config.logger = awslog;

var cli_resources = [];
var check_objects = [];

function blockUI() { }
function unblockUI() { }
function nav(str) {
    return str.replace(/\s/g, "").replace(/\,/g, "").replace(/\-/g, "").replace(/\&amp\;/g, "And");
}
const iaclangselect = "typescript";

function $(selector) { return new $obj(selector) }
$obj = function (selector) { };
$obj.prototype.bootstrapTable = function (action, data) {
    if (action == "append") {
        cli_resources = [...cli_resources, ...data];
    }
}
$obj.prototype.deferredBootstrapTable = function (action, data) {
    if (action == "append") {
        cli_resources = [...cli_resources, ...data];
    }
}
$.notify = function () { }

var region = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';
var stack_parameters = [];
eval(fs.readFileSync(path.join(__dirname, 'deepmerge.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, 'mappings.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, 'datatables.js'), 'utf8'));
var items = fs.readdirSync(path.join(__dirname, 'services'));
for (var i=0; i<items.length; i++) {
    eval(fs.readFileSync(path.join(__dirname, 'services', items[i]), 'utf8'));
};

f2log = function(msg){};
f2trace = function(err){};

async function main(opts) {
    if (!opts.outputRawData && !opts.outputCloudformation && !opts.outputTerraform) {
        throw new Error('You must specify an output type');
    }

    if (opts.debug) {
        f2log = function(msg){ console.log(msg); };
        f2trace = function(err){ console.trace(err); };
        f2debug = function(msg){ console.log(Date.now().toString() + ": " + msg); };
    }

    if (opts.profile) {
        AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: opts.profile});
    }

    if (opts.region) {
        AWS.config.update({region: opts.region});
        region = opts.region;
    }

    if (opts.proxy) {
        AWS.config.update({httpOptions: {agent: proxy(opts.proxy)}});
    }

    if (opts.services) {
        var services = opts.services.split(",").map(x => x.toLowerCase());
        var newSections = [];
        for (var i in sections) {
            if (services.includes(nav(sections[i].service).toLowerCase())) {
                newSections.push(sections[i]);
            }
        }
        sections = newSections;
    }

    if (opts.excludeServices) {
        var excludeServices = opts.excludeServices.split(",").map(x => x.toLowerCase());
        for (var i in sections) {
            if (excludeServices.includes(nav(sections[i].service).toLowerCase())) {
                delete sections[i];
            }
        }
        sections = sections.filter(val => val); // reindex
    }

    if (opts.cfnDeletionPolicy && opts.cfnDeletionPolicy != "Delete" && opts.cfnDeletionPolicy != "Retain") {
        throw new Error('You must specify --cfn-deletion-policy value in [Delete, Retain]');
    }

    outputMapCdk = function(){};
    outputMapTroposphere = function(){};
    outputMapPulumi = function(){};
    outputMapCdktf = function(){};
    if (!opts.outputCloudformation) { outputMapCfn = function(){}; }
    if (!opts.outputTerraform) { outputMapTf = function(){}; }

    const b1 = new cliprogress.SingleBar({
        format: _colors.cyan('{bar}') + '  {percentage}% ({value}/{total} services completed)',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: false
    });

    b1.start(sections.length, 0);

    await Promise.all(
        sections
        .map(section => {
            let dtname = 'updateDatatable' + nav(section.category) + nav(section.service);
            return eval(dtname);
        })
        .map(work =>
            new Promise(async resolve => {
                try {
                    await work();
                } catch (err) {
                    awslog.warn(util.format('updateDatatable failed: %j', err));
                } finally {
                    b1.increment();
                    resolve();
                }
            })
        )
    );

    b1.stop();

    if (opts.sortOutput) {
        cli_resources = cli_resources.sort((a, b) => (a.f2id > b.f2id) ? 1 : -1);
    }

    if (opts.outputRawData) {
        fs.writeFileSync(opts.outputRawData, JSON.stringify(cli_resources, null, 4));
    }

    if (opts.outputCloudformation || opts.outputTerraform) {
        var output_objects = [];

        for (var i=0; i<cli_resources.length; i++) {
            if (opts.searchFilter) {
                var jsonres = JSON.stringify(cli_resources[i]);
                if (opts.searchFilter.includes(",")) {
                    for (var searchterm of opts.searchFilter.split(",")) {
                        if (jsonres.includes(searchterm)) {
                            output_objects.push({
                                'id': cli_resources[i].f2id,
                                'type': cli_resources[i].f2type,
                                'data': cli_resources[i].f2data,
                                'region': cli_resources[i].f2region
                            });
                            break;
                        }
                    }
                } else {
                    if (jsonres.includes(opts.searchFilter)) {
                        output_objects.push({
                            'id': cli_resources[i].f2id,
                            'type': cli_resources[i].f2type,
                            'data': cli_resources[i].f2data,
                            'region': cli_resources[i].f2region
                        });
                    }
                }
            } else {
                output_objects.push({
                    'id': cli_resources[i].f2id,
                    'type': cli_resources[i].f2type,
                    'data': cli_resources[i].f2data,
                    'region': cli_resources[i].f2region
                });
            }
        }

        var tracked_resources = performF2Mappings(output_objects);
        var mapped_outputs = compileOutputs(tracked_resources, opts.cfnDeletionPolicy);

        if (opts.outputCloudformation) {
            fs.writeFileSync(opts.outputCloudformation, mapped_outputs['cfn']);
        }

        if (opts.outputTerraform) {
            fs.writeFileSync(opts.outputTerraform, mapped_outputs['tf']);
        }
    }
}

let validation = false;
cliargs
    .version(pjson.version)
    .command('generate')
    .description('generates outputs and writes them to the specified file')
    .option('--output-cloudformation <filename>', 'filename for CloudFormation output')
    .option('--output-terraform <filename>', 'filename for Terraform output')
    .option('--output-raw-data <filename>', 'filename for debug output (full)')
    .option('--cfn-deletion-policy <Delete|Retain>', 'add DeletionPolicy in CloudFormation output')
    .option('--search-filter <value>', 'search filter for discovered resources (can be comma separated)')
    .option('--services <value>', 'list of services to include (can be comma separated (default: ALL))')
    .option('--exclude-services <value>', 'list of services to exclude (can be comma separated)')
    .option('--sort-output', 'sort resources by their ID before outputting')
    .option('--region <regionname>', 'overrides the default AWS region to scan')
    .option('--profile <profilename>', 'uses the profile specified from the shared credentials file')
    .option('--proxy <protocol://host:port>', 'use proxy')
    .option('--debug', 'log debugging messages')
    .action(async (opts) => {
        // The followings are here to silence Node runtime complaining about event emitter listeners
        // due to the number of TLS requests that suddenly go out to AWS APIs. This is harmless here
        require('events').EventEmitter.defaultMaxListeners = 1000;
        process.setMaxListeners(0);
        validation = true;
        try {
            await main(opts);
        } catch(err) {
            console.log("\nERROR: " + err.message + "\n")
            cliargs.help();
        }
    });

cliargs.parse(process.argv);
if (!validation) {
    cliargs.help();
}
