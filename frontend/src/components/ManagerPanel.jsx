export default function ManagerPanel() {

    const requests = [

        {
            employee: "Priya Sharma",
            workspace: "Feature-Payment",
            reason: "Production Bug Fix"
        },

        {
            employee: "Ravi Kumar",
            workspace: "Feature-Login",
            reason: "Sprint Deadline"
        }

    ];

    return (

        <div className="mt-10 bg-slate-800 rounded-xl p-6">

            <h2 className="text-2xl font-bold mb-6">
                Manager Overtime Requests
            </h2>

            <table className="w-full">

                <thead>

                    <tr className="border-b border-slate-700 text-slate-400">

                        <th className="text-left pb-3">Employee</th>
                        <th className="text-left pb-3">Workspace</th>
                        <th className="text-left pb-3">Reason</th>
                        <th className="text-left pb-3">Approve</th>

                    </tr>

                </thead>

                <tbody>

                    {requests.map((req, index) => (

                        <tr
                            key={index}
                            className="border-b border-slate-700"
                        >

                            <td className="py-4">
                                {req.employee}
                            </td>

                            <td>
                                {req.workspace}
                            </td>

                            <td>
                                {req.reason}
                            </td>

                            <td>

                                <button
                                    className="bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded"
                                >
                                    Approve
                                </button>

                            </td>

                        </tr>

                    ))}

                </tbody>

            </table>

        </div>

    );

}