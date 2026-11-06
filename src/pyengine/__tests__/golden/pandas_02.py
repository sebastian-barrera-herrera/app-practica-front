import io
import numpy as np
import pandas as pd

csv = """ciudad,mes,ventas,unidades
Madrid,ene,120.5,10
Madrid,feb,98.0,8
Lima,ene,75.25,6
Lima,feb,,7
Quito,ene,60.0,5
Quito,feb,64.5,
"""
df = pd.read_csv(io.StringIO(csv))
print(df)
print(df.dtypes)
print(df.isna().sum())
print(df.info())
print(df.describe())
print(df.groupby("ciudad")["ventas"].mean())
print(df.groupby("ciudad").sum(numeric_only=True))
print(df.groupby(["ciudad", "mes"])["unidades"].sum())
print(df.groupby("mes").agg({"ventas": "sum", "unidades": "max"}))
print(df.groupby("ciudad").size())
print(df["ventas"].fillna(df["ventas"].mean()))
print(df.dropna())
print(df.fillna(0))
print(df["ciudad"].value_counts())
print(df["ciudad"].unique())
print(df.nunique())
print(df.sort_values(["ciudad", "ventas"], ascending=[True, False]))
print(df.to_csv(index=False))

a = pd.DataFrame({"id": [1, 2, 3], "x": ["a", "b", "c"]})
b = pd.DataFrame({"id": [2, 3, 4], "y": [20, 30, 40]})
print(a.merge(b, on="id"))
print(a.merge(b, on="id", how="left"))
print(a.merge(b, on="id", how="outer"))
print(pd.concat([a, a], ignore_index=True))
print(pd.concat([a, b.rename(columns={"id": "id2"})], axis=1))
print(pd.get_dummies(df["ciudad"]))
print(pd.get_dummies(df[["ciudad", "unidades"]], dtype=int))
print(df.apply(lambda r: r["ventas"] * 2 if r["ciudad"] == "Lima" else 0, axis=1))
print(df["ventas"].apply(lambda v: v + 1))
print(df["ciudad"].str.upper())
print(df["ciudad"].str.contains("i"))
print(df.corr(numeric_only=True))
print(pd.cut(pd.Series([1, 7, 15, 30]), bins=[0, 5, 20, 100]).astype(str).tolist())
print(pd.cut(pd.Series([1, 7, 15, 30]), bins=[0, 5, 20, 100], labels=["bajo", "medio", "alto"]).astype(str).tolist())
print(df.pivot_table(values="unidades", index="ciudad", columns="mes", aggfunc="sum"))
print(pd.crosstab(df["ciudad"], df["mes"]))
