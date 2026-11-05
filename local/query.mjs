const ident = (value) => {
  if (!/^[a-z_][a-z_0-9]*$/i.test(value)) throw new Error('Invalid identifier');
  return `"${value}"`;
};
export function splitFields(value) {
  let depth = 0,
    start = 0;
  const fields = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    if (value[i] === ')') depth--;
    if (value[i] === ',' && depth === 0) {
      fields.push(value.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) throw new Error('Invalid fields');
  return [...fields, value.slice(start)].map((f) => f.trim()).filter(Boolean);
}
export async function queryDatabase(tx, plan) {
  const params = [];
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const table = ident(plan.table);
  if (plan.table === 'local_migrations') throw new Error('Private table');
  let aliasIndex = 0;
  const relationships = (
    await tx.query(`select c.conname,s.relname source,t.relname target,sa.attname source_col,ta.attname target_col
    from pg_constraint c join pg_class s on s.oid=c.conrelid join pg_class t on t.oid=c.confrelid
    join pg_namespace ns on ns.oid=s.relnamespace
    join pg_attribute sa on sa.attrelid=s.oid and sa.attnum=c.conkey[1]
    join pg_attribute ta on ta.attrelid=t.oid and ta.attnum=c.confkey[1]
    where c.contype='f' and ns.nspname='public' and array_length(c.conkey,1)=1`)
  ).rows;
  function fields(tableName, sourceAlias, expression, depth = 0) {
    if (depth > 5) throw new Error('Too many nested relationships');
    return splitFields(expression || '*')
      .map((field) => {
        if (field === '*') return `${sourceAlias}.*`;
        if (!field.includes('(')) {
          const [a, b] = field.split(':');
          return `${sourceAlias}.${ident(b || a)}${b ? ` as ${ident(a)}` : ''}`;
        }
        const match = /^([\w:!]+)\((.*)\)$/.exec(field);
        if (!match) throw new Error('Invalid relationship');
        const [reference, nested] = [match[1], match[2]];
        const [label, spec] = reference.includes(':')
          ? reference.split(':')
          : [reference.split('!')[0], reference];
        const [target, hint] = spec.split('!');
        ident(target);
        const candidates = relationships.filter(
          (r) =>
            ((r.source === tableName && r.target === target) ||
              (r.target === tableName && r.source === target)) &&
            (!hint ||
              hint === 'inner' ||
              r.conname === hint ||
              r.source_col === hint),
        );
        if (candidates.length !== 1)
          throw new Error(
            `Ambiguous or unknown relationship: ${tableName}.${reference}`,
          );
        const relation = candidates[0];
        const forward = relation.source === tableName;
        const a = `r${++aliasIndex}`;
        const condition = forward
          ? `${a}.${ident(relation.target_col)}=${sourceAlias}.${ident(relation.source_col)}`
          : `${a}.${ident(relation.source_col)}=${sourceAlias}.${ident(relation.target_col)}`;
        const selection =
          nested === 'count'
            ? 'count(*)::integer as count'
            : fields(target, a, nested, depth + 1);
        return forward
          ? `(select row_to_json(j) from (select ${selection} from public.${ident(target)} ${a} where ${condition} limit 1) j) as ${ident(label)}`
          : `(select coalesce(json_agg(j),'[]'::json) from (select ${selection} from public.${ident(target)} ${a} where ${condition}) j) as ${ident(label)}`;
      })
      .join(',');
  }
  function filter(f, prefix = 't') {
    if (f.op === 'or')
      return `(${splitFields(f.value)
        .map((part) => {
          const m = /^([\w]+)\.([\w]+)\.(.*)$/.exec(part);
          if (!m) throw new Error('Invalid OR');
          return filter(
            {
              column: m[1],
              op: m[2],
              value:
                m[2] === 'in' ? m[3].replace(/^\(|\)$/g, '').split(',') : m[3],
            },
            prefix,
          );
        })
        .join(' or ')})`;
    const col = `${prefix}.${ident(f.column)}`;
    const ops = {
      eq: '=',
      neq: '<>',
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
      like: 'like',
      ilike: 'ilike',
    };
    let sql;
    if (f.op === 'is') {
      if (![null, true, false, 'null', 'true', 'false'].includes(f.value))
        throw new Error('Invalid IS');
      sql = `${col} is ${String(f.value)}`;
    } else if (f.op === 'in') {
      if (!Array.isArray(f.value)) throw new Error('Invalid IN');
      sql = f.value.length
        ? `${col} in (${f.value.map(bind).join(',')})`
        : 'false';
    } else if (ops[f.op]) sql = `${col} ${ops[f.op]} ${bind(f.value)}`;
    else throw new Error('Invalid operator');
    return f.negate ? `not (${sql})` : sql;
  }
  const conditions = (plan.filters || []).map((f) => filter(f));
  const where = conditions.length ? ` where ${conditions.join(' and ')}` : '';
  let result;
  if (!plan.operation || plan.operation === 'select') {
    const selection = fields(plan.table, 't', plan.columns);
    const order = (plan.orders || [])
      .map(
        (o) => `t.${ident(o.column)} ${o.ascending === false ? 'desc' : 'asc'}`,
      )
      .join(',');
    const limit = Math.min(
      Number.isInteger(plan.limit) && plan.limit >= 0 ? plan.limit : 10000,
      10000,
    );
    const count = plan.count
      ? Number(
          (
            await tx.query(
              `select count(*) from public.${table} t${where}`,
              params,
            )
          ).rows[0].count,
        )
      : null;
    const rows = plan.head
      ? []
      : (
          await tx.query(
            `select ${selection} from public.${table} t${where}${order ? ` order by ${order}` : ''} limit ${limit}`,
            params,
          )
        ).rows;
    result = { data: rows, error: null, count };
  } else {
    const records = Array.isArray(plan.values) ? plan.values : [plan.values];
    let sql;
    if (plan.operation === 'insert') {
      if (!records.length || !records[0]) throw new Error('Missing values');
      const keys = Object.keys(records[0]);
      sql = `insert into public.${table} as t (${keys.map(ident).join(',')}) values ${records.map((r) => `(${keys.map((k) => bind(r[k])).join(',')})`).join(',')}`;
    } else if (plan.operation === 'update') {
      sql = `update public.${table} as t set ${Object.entries(plan.values)
        .map(([k, v]) => `${ident(k)}=${bind(v)}`)
        .join(',')}${where}`;
    } else if (plan.operation === 'delete')
      sql = `delete from public.${table} as t${where}`;
    else throw new Error('Unsupported operation');
    const rows = (await tx.query(`${sql} returning *`, params)).rows;
    result = {
      data: plan.returning ? rows : null,
      error: null,
      count: rows.length,
    };
  }
  if (plan.single) {
    const rows = result.data || [];
    if (rows.length > 1 || (plan.single === 'required' && rows.length !== 1))
      return {
        data: null,
        error: { message: 'Expected one row', code: 'PGRST116' },
        count: result.count,
      };
    result.data = rows[0] || null;
  }
  return result;
}
export async function callFunction(tx, name, args = {}) {
  const keys = Object.keys(args);
  const functions = (
    await tx.query(
      `select p.oid,p.proargnames,p.proargtypes::oid[] as types,pg_get_function_result(p.oid) result
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`,
      [name],
    )
  ).rows;
  const fn = functions.find((f) =>
    keys.every((k) => (f.proargnames || []).includes(k)),
  );
  if (!fn) throw new Error('Unknown function');
  // Expose business operations only, never trigger/internal security helpers.
  if (
    !/^(propose_company_order_price|confirm_company_order_price|accept_order|apply_company_promo_code|apply_invitation_code|choose_company|claim_company_order|create_order|create_order_with_bonus|create_review|decide_company_membership|get_my_company_report|join_cleaner_community|join_company_community|preview_invitation_code|open_dispute|set_cleaner_workday|set_company_order_price|set_my_company_cashback|set_my_company_welcome_bonus|transition_order_status|update_cleaner_location)$/.test(
      name,
    )
  )
    throw new Error('Private function');
  const values = keys.map((k) =>
    typeof args[k] === 'object' && args[k] !== null && !Array.isArray(args[k])
      ? JSON.stringify(args[k])
      : args[k],
  );
  const rows = (
    await tx.query(
      `select * from public.${ident(name)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(',')})`,
      values,
    )
  ).rows;
  const scalar = /^(void|boolean|text|integer|bigint|jsonb|json|uuid)$/.test(
    fn.result,
  );
  return {
    data: scalar
      ? (rows[0]?.[name] ?? null)
      : /^SETOF|TABLE/.test(fn.result)
        ? rows
        : (rows[0] ?? null),
    error: null,
  };
}
