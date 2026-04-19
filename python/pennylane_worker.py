import json
import math
import os
import sys
import warnings
from typing import Any

import numpy as np


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def logistic(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-value))


def classical_utility(sample: np.ndarray) -> float:
    crew_risk, cost_pressure, comm_penalty, delta_v_pressure, uncertainty, radiation_pressure, schedule_pressure, confidence_gap = sample.tolist()
    raw = (
        0.30 * (1.0 - crew_risk)
        + 0.18 * (1.0 - cost_pressure)
        + 0.12 * (1.0 - comm_penalty)
        + 0.10 * (1.0 - delta_v_pressure)
        + 0.08 * (1.0 - uncertainty)
        + 0.12 * (1.0 - radiation_pressure)
        + 0.04 * (1.0 - schedule_pressure)
        + 0.06 * (1.0 - confidence_gap)
    )
    return clamp(raw, 0.0, 1.0)


def utility_to_policy(utility: float) -> str:
    if utility >= 0.68:
        return "CONTINUE"
    if utility >= 0.42:
        return "REPLAN"
    return "ABORT"


def policy_probabilities(utility: float) -> dict[str, float]:
    continue_score = logistic((utility - 0.68) * 10.0)
    abort_score = logistic((0.42 - utility) * 10.0)
    replan_score = max(0.0, 1.0 - continue_score - abort_score)
    total = max(continue_score + replan_score + abort_score, 1e-9)
    return {
      "continue": continue_score / total,
      "replan": replan_score / total,
      "abort": abort_score / total,
    }


def build_dataset(base_vector: np.ndarray, sample_count: int = 24) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(7)
    features = []
    labels = []
    for index in range(sample_count):
        if index == 0:
            sample = base_vector.copy()
        else:
            perturb = rng.normal(0.0, 0.08, size=base_vector.shape[0])
            sample = np.clip(base_vector + perturb, 0.0, 1.0)
        features.append(sample)
        labels.append(classical_utility(sample))
    return np.array(features, dtype=float), np.array(labels, dtype=float)


def resolve_execution_mode(backend_mode: str, device_arn: str | None) -> tuple[str, bool]:
    if backend_mode == "braket-aws" and device_arn:
        arn = device_arn.lower()
        if "/qpu/" in arn:
            return "qpu", True
        return "remote-simulator", False
    return "simulator", False


def make_training_device(qml: Any, backend_mode: str, wires: int) -> tuple[Any, str]:
    if backend_mode == "lightning-sim":
        return qml.device("lightning.qubit", wires=wires), "pennylane/lightning.qubit"
    return qml.device("default.qubit", wires=wires), "pennylane/default.qubit"


def make_execution_device(qml: Any, backend_mode: str, wires: int, shots: int, device_arn: str | None) -> tuple[Any, str]:
    if backend_mode == "braket-local":
        try:
            import braket.pennylane_plugin  # noqa: F401
        except Exception as error:
            raise RuntimeError(f"Amazon Braket PennyLane plugin unavailable: {error}")
        return qml.device("braket.local.qubit", wires=wires, shots=shots), "amazon-braket/local"

    if backend_mode == "braket-aws":
        if not device_arn:
            raise RuntimeError("deviceArn is required for braket-aws execution")
        try:
            import braket.pennylane_plugin  # noqa: F401
        except Exception as error:
            raise RuntimeError(f"Amazon Braket PennyLane plugin unavailable: {error}")
        if not (
            os.getenv("AWS_ACCESS_KEY_ID")
            or os.getenv("AWS_PROFILE")
            or os.getenv("AWS_SESSION_TOKEN")
        ):
            raise RuntimeError("AWS credentials or AWS_PROFILE are required for braket-aws execution")
        return qml.device("braket.aws.qubit", device_arn=device_arn, wires=wires, shots=shots), "amazon-braket/aws"

    dev, label = make_training_device(qml, backend_mode, wires)
    return dev, label


def main() -> None:
    raw = sys.stdin.read()
    payload = json.loads(raw or "{}")
    warnings.filterwarnings("ignore")

    try:
        import pennylane as qml
        from pennylane import numpy as pnp
    except Exception as error:
        print(json.dumps({
            "installed": False,
            "available": False,
            "source": "LOCAL · PennyLane unavailable",
            "error": str(error),
            "installHint": "Install pennylane and pennylane-lightning in the local Python environment.",
        }))
        return

    features = payload.get("features") or []
    names = [str(item.get("name", f"f{idx}")) for idx, item in enumerate(features)]
    values = np.array([clamp(float(item.get("value", 0.0)), 0.0, 1.0) for item in features], dtype=float)

    if values.size == 0:
        print(json.dumps({
            "installed": True,
            "available": False,
            "source": "LOCAL · PennyLane worker",
            "error": "No feature vector provided",
        }))
        return

    if values.size < 8:
        values = np.pad(values, (0, 8 - values.size), mode="constant")
        while len(names) < 8:
            names.append(f"f{len(names)}")

    x_train, y_train = build_dataset(values)
    wires = min(8, len(values))
    feature_dim = wires
    n_layers = 2
    epochs = int(payload.get("epochs") or 36)
    learning_rate = float(payload.get("learningRate") or 0.18)
    backend_mode = str(payload.get("backendMode") or "lightning-sim")
    device_arn = payload.get("deviceArn")
    shots = int(payload.get("shots") or 256)
    fallback_reason = None
    if backend_mode in {"braket-local", "braket-aws"}:
        fallback_reason = "Amazon Braket hardware execution is unavailable in this environment; using local PennyLane simulation instead."
        backend_mode = "lightning-sim"
        device_arn = None
    execution_mode, hardware_executed = resolve_execution_mode(backend_mode, device_arn)
    dev, backend_label = make_training_device(qml, backend_mode, wires)
    weights = pnp.array(0.01 * np.random.default_rng(11).normal(size=(n_layers, feature_dim, 3)), requires_grad=True)

    @qml.qnode(dev, interface="autograd")
    def circuit(inputs, theta):
        qml.AngleEmbedding(inputs[:feature_dim] * math.pi, wires=range(feature_dim), rotation="Y")
        qml.StronglyEntanglingLayers(theta, wires=range(feature_dim))
        return [qml.expval(qml.PauliZ(i)) for i in range(feature_dim)]

    def model(inputs, theta):
        outputs = pnp.array(circuit(inputs, theta))
        return pnp.mean((1.0 - outputs) / 2.0)

    def loss(theta):
        predictions = pnp.array([model(row, theta) for row in x_train])
        return pnp.mean((predictions - y_train) ** 2)

    optimizer = qml.AdamOptimizer(learning_rate)
    for _ in range(epochs):
        weights = optimizer.step(loss, weights)

    training_loss = float(loss(weights))
    predictions = np.array([float(model(row, weights)) for row in x_train])
    utility = float(model(values, weights))
    rmse = float(np.sqrt(np.mean((predictions - y_train) ** 2)))
    fit_score = clamp(1.0 - rmse, 0.0, 1.0)
    probabilities = policy_probabilities(utility)
    recommendation = utility_to_policy(utility)
    execution_observables = None

    if backend_mode in {"braket-local", "braket-aws"}:
        exec_dev, exec_label = make_execution_device(qml, backend_mode, wires, shots, device_arn)

        @qml.qnode(exec_dev)
        def execution_circuit(inputs, theta):
            qml.AngleEmbedding(inputs[:feature_dim] * math.pi, wires=range(feature_dim), rotation="Y")
            qml.StronglyEntanglingLayers(theta, wires=range(feature_dim))
            return [qml.expval(qml.PauliZ(i)) for i in range(feature_dim)]

        execution_values = execution_circuit(values, weights)
        execution_observables = [float(item) for item in execution_values]
        utility = float(np.mean((1.0 - np.array(execution_observables)) / 2.0))
        probabilities = policy_probabilities(utility)
        recommendation = utility_to_policy(utility)
        backend_label = exec_label

    local_importance = []
    baseline = utility
    for idx in range(feature_dim):
        shifted = values.copy()
        shifted[idx] = clamp(float(shifted[idx] + 0.05), 0.0, 1.0)
        shifted_utility = float(model(shifted, weights))
        local_importance.append({
            "name": names[idx],
            "value": float(values[idx]),
            "sensitivity": float(shifted_utility - baseline),
        })

    local_importance.sort(key=lambda item: abs(item["sensitivity"]), reverse=True)

    print(json.dumps({
        "installed": True,
        "available": True,
        "source": "LOCAL · PennyLane variational regressor",
        "backend": backend_label,
        "executionMode": execution_mode,
        "hardwareCapable": backend_mode == "braket-aws",
        "hardwareExecuted": hardware_executed,
        "deviceArn": device_arn,
        "wires": wires,
        "layers": n_layers,
        "epochs": epochs,
        "trainingLoss": training_loss,
        "fitScore": fit_score,
        "utilityScore": utility,
        "recommendation": recommendation,
        "confidence": max(probabilities.values()),
        "probabilities": probabilities,
        "featureVector": [{"name": names[idx], "value": float(values[idx])} for idx in range(feature_dim)],
        "featureImportance": local_importance[:4],
        "executionObservables": execution_observables,
        "explanation": [
            "PennyLane trains a local variational regressor on mission features and physics-derived neighborhood labels.",
            "The trained circuit is executed on a local PennyLane simulator for inference in this environment.",
            *( [fallback_reason] if fallback_reason else [] ),
            f"Predicted utility {utility:.3f} maps to {recommendation}.",
            f"Local surrogate fit score is {fit_score:.3f}.",
        ],
    }))


if __name__ == "__main__":
    main()
