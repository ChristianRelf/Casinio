import { JoinClient } from "../../../components/lobby/JoinClient";
export default async function JoinPage({params}:{params:Promise<{code:string}>}){const{code}=await params;return <JoinClient code={code.toUpperCase()}/>}
