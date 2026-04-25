import sys
import numpy as np
import pandas as pd
import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path
from sklearn.model_selection import StratifiedGroupKFold, cross_val_score, GridSearchCV, train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestClassifier, ExtraTreesClassifier, VotingClassifier
from sklearn.metrics import accuracy_score, f1_score, confusion_matrix, ConfusionMatrixDisplay, classification_report

sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

def train_and_evaluate():
    print(f"Loading data from {config.FEATURES_FILE}...")
    try:
        data = pd.read_csv(config.FEATURES_FILE)
    except FileNotFoundError:
        print(f"Error: {config.FEATURES_FILE} not found. Run the extraction script first.")
        return

    X = data.drop("label", axis=1)
    y = data["label"]

    print(f"Dataset: {X.shape[0]} windows x {X.shape[1]} features")
    print(f"Class balance:\n{y.value_counts().to_string()}\n")

    # Scale features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    joblib.dump(scaler, config.MODELS_DIR / "scaler.pkl")
    print("StandardScaler saved.")

    # Stratified 80/20 split
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.2, random_state=42, stratify=y
    )

    # ── Grid search: Random Forest ───────────────────────────────────────────
    print("Running RandomForest GridSearchCV (this may take a few minutes)...")
    rf_param_grid = {
        "n_estimators":      [300, 600],
        "max_depth":         [None, 20, 30],
        "min_samples_split": [2, 5],
        "max_features":      ["sqrt", 0.3],
        "class_weight":      ["balanced"],
    }
    rf_base = RandomForestClassifier(random_state=42, n_jobs=-1)
    rf_grid = GridSearchCV(rf_base, rf_param_grid, cv=5, scoring="accuracy",
                           n_jobs=-1, verbose=1)
    rf_grid.fit(X_train, y_train)
    print(f"  RF best params: {rf_grid.best_params_}")
    print(f"  RF best CV acc: {rf_grid.best_score_ * 100:.2f}%")

    # ── Grid search: ExtraTrees ──────────────────────────────────────────────
    print("Running ExtraTrees GridSearchCV...")
    et_param_grid = {
        "n_estimators":      [300, 600],
        "max_depth":         [None, 20, 30],
        "min_samples_split": [2, 5],
        "max_features":      ["sqrt", 0.3],
        "class_weight":      ["balanced"],
    }
    et_base = ExtraTreesClassifier(random_state=42, n_jobs=-1)
    et_grid = GridSearchCV(et_base, et_param_grid, cv=5, scoring="accuracy",
                           n_jobs=-1, verbose=1)
    et_grid.fit(X_train, y_train)
    print(f"  ET best params: {et_grid.best_params_}")
    print(f"  ET best CV acc: {et_grid.best_score_ * 100:.2f}%")

    # ── Pick best individual model ────────────────────────────────────────────
    if rf_grid.best_score_ >= et_grid.best_score_:
        best_single = rf_grid.best_estimator_
        print("\nSelected: RandomForest")
    else:
        best_single = et_grid.best_estimator_
        print("\nSelected: ExtraTrees")

    # ── Soft-vote ensemble (RF + ET) ──────────────────────────────────────────
    ensemble = VotingClassifier(
        estimators=[("rf", rf_grid.best_estimator_), ("et", et_grid.best_estimator_)],
        voting="soft",
        n_jobs=-1,
    )
    ensemble.fit(X_train, y_train)

    # ── Evaluate both and pick winner ─────────────────────────────────────────
    y_pred_single   = best_single.predict(X_test)
    y_pred_ensemble = ensemble.predict(X_test)
    acc_single   = accuracy_score(y_test, y_pred_single)
    acc_ensemble = accuracy_score(y_test, y_pred_ensemble)
    print(f"  Single model test acc : {acc_single   * 100:.2f}%")
    print(f"  Ensemble test acc     : {acc_ensemble * 100:.2f}%")

    if acc_ensemble >= acc_single:
        best_model = ensemble
        y_pred = y_pred_ensemble
        acc = acc_ensemble
        importance_source = None          # VotingClassifier has no .feature_importances_
        print("Winner: Ensemble")
    else:
        best_model = best_single
        y_pred = y_pred_single
        acc = acc_single
        importance_source = best_single
        print("Winner: Single model")

    f1 = f1_score(y_test, y_pred, average="weighted")
    print(f"\nTest Accuracy : {acc * 100:.2f}%")
    print(f"Weighted F1   : {f1 * 100:.2f}%\n")
    print(classification_report(y_test, y_pred, target_names=["Non-Leak", "Leak"]))

    # ── Feature importance (only if we have it) ───────────────────────────────
    if importance_source is not None:
        importances = pd.Series(importance_source.feature_importances_, index=X.columns)
        importances.sort_values(ascending=False, inplace=True)
        print("Top 10 features:")
        print(importances.head(10).to_string())
        fig, ax = plt.subplots(figsize=(10, 5))
        importances.head(15).plot.bar(ax=ax)
        ax.set_title("Top 15 Feature Importances")
        ax.set_ylabel("Importance")
        plt.tight_layout()
        plt.savefig(config.MODELS_DIR / "feature_importance.png")

    # ── Confusion matrix ──────────────────────────────────────────────────────
    cm = confusion_matrix(y_test, y_pred)
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=["Non-Leak", "Leak"])
    disp.plot(cmap=plt.cm.Blues)
    plt.title("Best Model — Confusion Matrix")
    plt.savefig(config.MODELS_DIR / "confusion_matrix.png")

    # ── Save model ────────────────────────────────────────────────────────────
    model_path = config.MODELS_DIR / "random_forest_model.pkl"
    joblib.dump(best_model, model_path)
    print(f"\nModel saved -> {model_path}")
    print("Plots saved -> models/confusion_matrix.png  |  models/feature_importance.png")

if __name__ == "__main__":
    train_and_evaluate()
