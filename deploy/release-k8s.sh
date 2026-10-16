#!/bin/sh
set -eu

# Execute only from an authorized deployment job with a configured kubectl
# context. Inputs must be rendered and reviewed for the target environment.
namespace=${1:?Supply target namespace}
migration=${2:?Supply rendered migration Job file}
workloads=${3:?Supply rendered workload directory}

# create (not apply) deliberately refuses to reuse an old successful Job. Give
# every release attempt a new name, retaining failed attempts for inspection.
job=$(kubectl --namespace "$namespace" create -f "$migration" -o 'jsonpath={.metadata.name}')
test -n "$job"

if ! kubectl --namespace "$namespace" wait --for=condition=complete "job/$job" --timeout=960s; then
  printf 'Migration Job %s did not complete. Application rollout was not started. Inspect the Job in the target namespace.\n' "$job" >&2
  exit 1
fi

kubectl --namespace "$namespace" apply -f "$workloads"
kubectl --namespace "$namespace" rollout status deployment/kanvas --timeout=900s
